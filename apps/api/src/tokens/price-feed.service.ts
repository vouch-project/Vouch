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
    this.intervalMs = Number(
      this.configService.get<string>('PRICE_FEED_INTERVAL_MS') ?? '60000',
    );
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
            const [, answer, , updatedAt] = (await feed.latestRoundData()) as [
              unknown,
              bigint,
              unknown,
              bigint,
              unknown,
            ];
            const decimals = Number(await feed.decimals());

            if (answer <= 0n) return;
            if (Date.now() - Number(updatedAt) * 1000 > STALE_THRESHOLD_MS) {
              this.logger.warn(
                `Stale price for chain ${token.chainId} ${token.symbol}`,
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
