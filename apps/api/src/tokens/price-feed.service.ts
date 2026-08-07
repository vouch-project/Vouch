import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import type { Redis } from 'ioredis';
import { SupabaseService } from '../supabase/supabase.service';

const AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)',
  'function decimals() external view returns (uint8)',
];

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const REDIS_KEY = 'prices:cache';
const REDIS_TTL = 30; // seconds
const DEFAULT_INTERVAL_MS = 60000;

// Keyed by "chainId:address" — tokens are only unique per chain (see the
// tokens_chainId_address_unique index), and symbols can collide across chains.
type PriceMap = Record<string, number>;

export const priceKey = (chainId: string, address: string): string =>
  `${chainId}:${address.toLowerCase()}`;

@Injectable()
export class PriceFeedService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceFeedService.name);
  private readonly intervalMs: number;
  private intervalHandle: NodeJS.Timeout | undefined;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    const configured = Number(
      this.configService.get<string>('PRICE_FEED_INTERVAL_MS'),
    );
    // A non-numeric PRICE_FEED_INTERVAL_MS would otherwise make setInterval run
    // effectively immediately (Node clamps a NaN delay to ~1ms), hammering the
    // RPC provider, DB, and Redis on every tick.
    this.intervalMs =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_INTERVAL_MS;
  }

  async onModuleInit() {
    await this.refreshPrices();
    this.intervalHandle = setInterval(
      () => void this.refreshPrices(),
      this.intervalMs,
    );
  }

  onModuleDestroy() {
    clearInterval(this.intervalHandle);
  }

  /** Returns the cached price map, keyed by `priceKey(chainId, address)`. */
  async getPrices(): Promise<PriceMap> {
    const cached = await this.redis.get(REDIS_KEY);
    if (cached) {
      const parsed = this.parsePriceMap(cached, 'cached');
      if (parsed) return parsed;
    }
    await this.refreshPrices();
    const fresh = await this.redis.get(REDIS_KEY);
    if (!fresh) return {};
    return this.parsePriceMap(fresh, 'refreshed') ?? {};
  }

  /**
   * Fetches and caches the price for a single token. Used by TokensService to
   * fill in prices for tokens that were not present during the last bulk poll
   * (e.g. newly registered tokens between poll intervals).
   *
   * Warms the Redis cache so subsequent calls and the next bulk poll both see it.
   */
  async getPriceForToken(
    chainId: string,
    address: string,
    feedAddress: string,
    rpcUrl: string,
  ): Promise<number | null> {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const price = await this.fetchPriceFromFeed(
      chainId,
      address,
      feedAddress,
      provider,
    );
    if (price === null) return null;

    // Warm the shared Redis cache so the next getPrices() call sees this token.
    const cached = await this.redis.get(REDIS_KEY);
    const map: PriceMap = cached
      ? (this.parsePriceMap(cached, 'cached') ?? {})
      : {};
    map[priceKey(chainId, address)] = price;
    await this.redis.set(REDIS_KEY, JSON.stringify(map), 'EX', REDIS_TTL);

    return price;
  }

  // A corrupted or partially-written Redis value would otherwise throw and
  // bubble up to getTokens()'s callers, breaking the /tokens endpoint entirely.
  // Applies the same defensive parsing to both the cached and refreshed paths.
  private parsePriceMap(
    raw: string,
    source: 'cached' | 'refreshed',
  ): PriceMap | null {
    try {
      return JSON.parse(raw) as PriceMap;
    } catch {
      this.logger.warn(`Failed to parse ${source} price map`);
      return null;
    }
  }

  /**
   * Calls latestRoundData() on a Chainlink aggregator and returns the USD price,
   * or null if the feed is stale, invalid, or errors. Applies the same checks as
   * VouchVault._getPrice so the API never shows a price the contract would reject.
   */
  private async fetchPriceFromFeed(
    chainId: string,
    symbol: string,
    feedAddress: string,
    provider: ethers.JsonRpcProvider,
  ): Promise<number | null> {
    if (feedAddress.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
      return null;
    }
    try {
      const feed = new ethers.Contract(feedAddress, AGGREGATOR_ABI, provider);
      const [roundId, answer, , updatedAt, answeredInRound] =
        (await feed.latestRoundData()) as [
          bigint,
          bigint,
          unknown,
          bigint,
          bigint,
        ];
      const decimals = Number(await feed.decimals());

      if (answer <= 0n) return null;
      if (answeredInRound < roundId) {
        this.logger.warn(`Stale round for chain ${chainId} ${symbol}`);
        return null;
      }
      const updatedAtMs = Number(updatedAt) * 1000;
      if (updatedAtMs > Date.now()) {
        this.logger.warn(`Future timestamp for chain ${chainId} ${symbol}`);
        return null;
      }
      if (Date.now() - updatedAtMs > STALE_THRESHOLD_MS) {
        this.logger.warn(`Stale price for chain ${chainId} ${symbol}`);
        return null;
      }
      if (decimals > 18) {
        this.logger.warn(
          `Feed decimals too large for chain ${chainId} ${symbol}`,
        );
        return null;
      }

      return Number(ethers.formatUnits(answer, decimals));
    } catch (err) {
      this.logger.warn(
        `Failed to fetch price for chain ${chainId} ${symbol}: ${err}`,
      );
      return null;
    }
  }

  private async refreshPrices(): Promise<void> {
    try {
      const { data: tokens, error } = await this.supabaseService.client
        .from('tokens')
        .select('chainId, address, symbol, price_feed_address, chains(rpcUrl)');

      if (error || !tokens?.length) return;

      const providersByChain = new Map<string, ethers.JsonRpcProvider>();
      const getProvider = (
        chainId: string,
        rpcUrl: string,
      ): ethers.JsonRpcProvider => {
        let provider = providersByChain.get(chainId);
        if (!provider) {
          provider = new ethers.JsonRpcProvider(rpcUrl);
          providersByChain.set(chainId, provider);
        }
        return provider;
      };

      const priceMap: PriceMap = {};

      await Promise.all(
        tokens.map(async (token) => {
          const rpcUrl = token.chains?.rpcUrl;
          if (!rpcUrl) {
            this.logger.warn(
              `No rpcUrl for chain ${token.chainId}, skipping ${token.symbol}`,
            );
            return;
          }

          const price = await this.fetchPriceFromFeed(
            token.chainId,
            token.symbol,
            token.price_feed_address!,
            getProvider(token.chainId, rpcUrl),
          );

          if (price === null) return;

          priceMap[priceKey(token.chainId, token.address)] = price;
        }),
      );

      if (Object.keys(priceMap).length > 0) {
        await this.redis.set(
          REDIS_KEY,
          JSON.stringify(priceMap),
          'EX',
          REDIS_TTL,
        );
        this.logger.log(
          `Prices refreshed: ${Object.keys(priceMap).length} tokens`,
        );
      } else {
        this.logger.warn(
          'Price refresh produced no prices, keeping previous cache',
        );
      }
    } catch (err) {
      this.logger.error('Price refresh failed:', err);
    }
  }
}
