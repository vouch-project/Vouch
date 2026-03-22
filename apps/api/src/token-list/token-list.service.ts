import { InjectRedis } from '@nestjs-modules/ioredis';
import { HttpService } from '@nestjs/axios/dist/http.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config/dist/config.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UUID } from 'crypto';
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
  private readonly tokenListUrl = 'https://li.quest/v1/tokens?chains=';
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

      const { data: tokenListData, error: tokenListError } =
        await this.supabaseService.client
          .from('chains')
          .select('id, networkId::text')
          .eq('networkType', 'evm');

      if (tokenListError) {
        this.logger.error(
          'Failed to fetch EVM chains from database',
          tokenListError,
        );
        return;
      }

      const evmChainIds = tokenListData?.map((chain) => chain.networkId) || [];

      if (evmChainIds.length === 0) {
        this.logger.warn(
          'No EVM chains found in database, skipping token list fetch',
        );
        return;
      }

      const raw = {
        ...(
          await this.httpService.axiosRef.get<TokenListResponse>(
            `${this.tokenListUrl}${evmChainIds.join(',')}`,
          )
        ).data.tokens,
        ...(HARDCODED_MOCK_ERC20_ADDRESS &&
          tokenListMock(HARDCODED_MOCK_ERC20_ADDRESS)),
      };

      const tokensArr = Object.values(raw).flat();

      const tokens = tokensArr.map((token) => {
        const chain = tokenListData?.find(
          (chain) => chain.networkId === token.chainId.toString(),
        );
        return {
          chainId: chain?.id as UUID,
          networkId: chain?.networkId,
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          logoURI: token.logoURI,
        };
      });

      const { data, error } = await this.supabaseService.client
        .from('token_list')
        .upsert(
          tokens.map((token) => {
            delete token.networkId;
            return token;
          }),
          { onConflict: 'chainId,address' },
        )
        .select('*, chainId, address');

      if (error) this.logger.error(`Error upserting tokens:`, error);

      // Cache in Redis per networkId
      if (data) {
        const tokensByNetwork: Record<string, Token[]> = {};
        for (const token of data) {
          // Find the networkId for this chainId
          const chain = tokenListData?.find((c) => c.id === token.chainId);
          if (!chain) continue;
          if (!tokensByNetwork[chain.networkId])
            tokensByNetwork[chain.networkId] = [];
          tokensByNetwork[chain.networkId].push(token);
        }

        const pipeline = this.redis.pipeline();
        for (const [networkId, tokens] of Object.entries(tokensByNetwork)) {
          pipeline.set(
            `${this.redisKeyPrefix}${networkId}`,
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

  async getTokenList(chainId: string): Promise<ResponseToken[]> {
    const redisKey = `${this.redisKeyPrefix}${chainId}`;
    // Try Redis cache first (now by networkId)
    const cached = await this.redis.get(redisKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ResponseToken[];
      } catch {
        this.logger.warn(
          `Failed to parse token list for networkId ${chainId} from Redis, refetching...`,
        );
      }
    }
    // Fallback: fetch and cache again
    await this.fetchTokenList();
    const refreshed = await this.redis.get(redisKey);
    return refreshed ? (JSON.parse(refreshed) as ResponseToken[]) : [];
  }
}
