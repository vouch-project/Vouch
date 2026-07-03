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
      try {
        return JSON.parse(cached) as PriceMap;
      } catch {
        this.logger.warn('Failed to parse cached price map, refreshing');
      }
    }
    await this.refreshPrices();
    const fresh = await this.redis.get(REDIS_KEY);
    return fresh ? (JSON.parse(fresh) as PriceMap) : {};
  }

  private async refreshPrices(): Promise<void> {
    try {
      const { data: tokens, error } = await this.supabaseService.client
        .from('tokens')
        .select('chainId, address, symbol, price_feed_address, chains(rpcUrl)')
        .not('price_feed_address', 'is', null);

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

          try {
            const feed = new ethers.Contract(
              token.price_feed_address!,
              AGGREGATOR_ABI,
              getProvider(token.chainId, rpcUrl),
            );
            const [roundId, answer, , updatedAt, answeredInRound] =
              (await feed.latestRoundData()) as [
                bigint,
                bigint,
                unknown,
                bigint,
                bigint,
              ];
            const decimals = Number(await feed.decimals());

            if (answer <= 0n) return;
            // Mirror VouchVault._getPrice's on-chain checks so this poller never
            // shows the frontend a "fresh" price that the contract would reject —
            // answeredInRound < roundId means the round carried over a stale
            // answer (e.g. during an aggregator outage).
            if (answeredInRound < roundId) {
              this.logger.warn(
                `Stale round for chain ${token.chainId} ${token.symbol}`,
              );
              return;
            }
            const updatedAtMs = Number(updatedAt) * 1000;
            // Without this check, a feed reporting a future timestamp would make
            // Date.now() - updatedAtMs negative — which is always <= the staleness
            // threshold, so the price would be wrongly treated as fresh.
            if (updatedAtMs > Date.now()) {
              this.logger.warn(
                `Future timestamp for chain ${token.chainId} ${token.symbol}`,
              );
              return;
            }
            if (Date.now() - updatedAtMs > STALE_THRESHOLD_MS) {
              this.logger.warn(
                `Stale price for chain ${token.chainId} ${token.symbol}`,
              );
              return;
            }
            // decimals is untrusted external input (the feed contract's own
            // decimals() call); VouchVault._getPrice caps at 18 for the same
            // reason — without this, the API could cache a price the contract
            // would itself reject.
            if (decimals > 18) {
              this.logger.warn(
                `Feed decimals too large for chain ${token.chainId} ${token.symbol}`,
              );
              return;
            }

            // Divide in exact decimal arithmetic via formatUnits before the unavoidable
            // final cast to a JS number — answer is a raw Chainlink integer that can
            // exceed Number.MAX_SAFE_INTEGER for 18-decimal feeds, so converting it to
            // a float first (Number(answer) / 10 ** decimals) risks losing precision
            // before the division ever happens.
            const price = Number(ethers.formatUnits(answer, decimals));
            priceMap[priceKey(token.chainId, token.address)] = price;

            await this.supabaseService.client
              .from('tokens')
              .update({ price_usd: price })
              .eq('chainId', token.chainId)
              .eq('address', token.address);
          } catch (err) {
            this.logger.warn(
              `Failed to fetch price for chain ${token.chainId} ${token.symbol}: ${err}`,
            );
          }
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
