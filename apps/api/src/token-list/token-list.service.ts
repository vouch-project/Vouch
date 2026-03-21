import { InjectRedis } from '@nestjs-modules/ioredis';
import { HttpService } from '@nestjs/axios/dist/http.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config/dist/config.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { SupabaseService } from '../supabase/supabase.service';
import { tokenListMock } from './token-list.mock';

export type ResponseToken = {
  chainId: number;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number | null;
  logoURI: string | null;
  priceUSD?: string;
  coinKey?: string;
};

export type TokenListResponse = {
  tokens: {
    [chainId: string]: ResponseToken[];
  };
};

export type Token = {
  chainId: string;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number | null;
  logoURI: string | null;
};

@Injectable()
export class TokenListService implements OnModuleInit {
  private readonly logger = new Logger(TokenListService.name);
  private readonly tokenListUrl = 'https://li.quest/v1/tokens?chains=1';
  private readonly redisKeyPrefix = 'token-list:cache:';

  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    await this.fetchTokenList();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  private async fetchTokenList() {
    this.logger.log('Fetching token list from Coingecko...');
    try {
      const HARDCODED_MOCK_ERC20_ADDRESS = this.configService.get<string>(
        'HARDCODED_MOCK_ERC20_ADDRESS',
      );

      const raw = {
        ...(
          await this.httpService.axiosRef.get<TokenListResponse>(
            this.tokenListUrl,
          )
        ).data.tokens,
        ...(HARDCODED_MOCK_ERC20_ADDRESS &&
          tokenListMock(HARDCODED_MOCK_ERC20_ADDRESS)),
      };

      const tokensArr = Object.values(raw).flat();

      const tokens = tokensArr.map((token) => ({
        chainId: token.chainId.toString(),
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoURI: token.logoURI,
      }));

      const { data, error } = await this.supabaseService.client
        .from('token_list')
        .upsert(tokens, { onConflict: 'chainId,address' })
        .select('*');

      if (error) this.logger.error(`Error upserting tokens:`, error);

      // Cache in Redis per chainId
      if (data) {
        const tokensByChain: Record<string, Token[]> = {};
        for (const token of data) {
          if (!tokensByChain[token.chainId]) tokensByChain[token.chainId] = [];
          tokensByChain[token.chainId].push(token);
        }

        const pipeline = this.redis.pipeline();
        for (const [chainId, tokens] of Object.entries(tokensByChain)) {
          pipeline.set(
            `${this.redisKeyPrefix}${chainId}`,
            JSON.stringify(tokens),
            'EX',
            24 * 60 * 60,
          ); // 24h expiry
        }
        await pipeline.exec();
      }
    } catch (err) {
      this.logger.error('Token list update failed:', err);
    }
  }

  async getTokenList(chainId: number): Promise<ResponseToken[]> {
    const redisKey = `${this.redisKeyPrefix}${chainId}`;
    // Try Redis cache first
    const cached = await this.redis.get(redisKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ResponseToken[];
      } catch {
        this.logger.warn(
          `Failed to parse token list for chainId ${chainId} from Redis, refetching...`,
        );
      }
    }
    // Fallback: fetch and cache again
    await this.fetchTokenList();
    const refreshed = await this.redis.get(redisKey);
    return refreshed ? (JSON.parse(refreshed) as ResponseToken[]) : [];
  }
}
