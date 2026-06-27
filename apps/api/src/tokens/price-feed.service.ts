import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

@Injectable()
export class PriceFeedService implements OnModuleInit {
  private readonly logger = new Logger(PriceFeedService.name);
  private intervalMs: number;
  private provider: ethers.JsonRpcProvider;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.intervalMs = Number(
      this.configService.get<string>('PRICE_FEED_INTERVAL_MS') ?? '60000',
    );
    const rpcUrl =
      this.configService.get<string>('RPC_URL') ?? 'http://localhost:8545';
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async onModuleInit() {
    await this.refreshPrices();
    setInterval(() => void this.refreshPrices(), this.intervalMs);
  }

  async getPrices(): Promise<Record<string, number>> {
    const cached = await this.redis.get(REDIS_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as Record<string, number>;
      } catch {}
    }
    await this.refreshPrices();
    const fresh = await this.redis.get(REDIS_KEY);
    return fresh ? (JSON.parse(fresh) as Record<string, number>) : {};
  }

  private async refreshPrices(): Promise<void> {
    try {
      const { data: tokens, error } = await this.supabaseService.client
        .from('tokens')
        .select('address, symbol, price_feed_address')
        .not('price_feed_address', 'is', null);

      if (error || !tokens?.length) return;

      const priceMap: Record<string, number> = {};

      await Promise.all(
        tokens.map(async (token) => {
          try {
            const feed = new ethers.Contract(
              token.price_feed_address!,
              AGGREGATOR_ABI,
              this.provider,
            );
            const [, answer, , updatedAt] = (await feed.latestRoundData()) as [
              unknown,
              bigint,
              unknown,
              bigint,
              unknown,
            ];
            const decimals: number = await feed.decimals();

            if (answer <= 0n) return;
            if (Date.now() - Number(updatedAt) * 1000 > STALE_THRESHOLD_MS) {
              this.logger.warn(`Stale price for ${token.symbol}`);
              return;
            }

            const price = Number(answer) / 10 ** decimals;
            priceMap[token.symbol] = price;

            await this.supabaseService.client
              .from('tokens')
              .update({ price_usd: price })
              .eq('address', token.address);
          } catch (err) {
            this.logger.warn(
              `Failed to fetch price for ${token.symbol}: ${err}`,
            );
          }
        }),
      );

      await this.redis.set(REDIS_KEY, JSON.stringify(priceMap), 'EX', REDIS_TTL);
      this.logger.log(`Prices refreshed: ${Object.keys(priceMap).join(', ')}`);
    } catch (err) {
      this.logger.error('Price refresh failed:', err);
    }
  }
}
