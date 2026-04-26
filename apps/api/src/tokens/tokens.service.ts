import { InjectRedis } from '@nestjs-modules/ioredis';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { UUID } from 'crypto';
import type { Redis } from 'ioredis';
import { validAddress, Tables } from '@vouch/database-types';
import { SupabaseService } from '../supabase/supabase.service';
import { tokensMock } from './tokens.mock';

export type ResponseToken = {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  name: string | null;
  logoURI: string | null;
  priceUSD?: string;
  coinKey?: string;
};

export type TokenListResponse = {
  tokens: {
    [chainId: string]: ResponseToken[];
  };
};

export type Token = Tables<'tokens'>;

type EvmChain = {
  id: UUID;
  networkId: string;
};

@Injectable()
export class TokensService implements OnModuleInit {
  private readonly logger = new Logger(TokensService.name);
  private readonly tokenListUrl = 'https://li.quest/v1/tokens?chains=';
  private readonly redisKeyPrefix = 'tokens:cache:';

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
    this.logger.log('Fetching token list from Li.Fi (li.quest)...');
    try {
      const mockErc20Address = this.getMockErc20Address();
      const evmChains = await this.fetchEvmChains();

      if (!evmChains) {
        return;
      }

      const evmChainIds = evmChains.map((chain) => chain.networkId);
      if (evmChainIds.length === 0) {
        this.logger.warn(
          'No EVM chains found in database, skipping token list fetch',
        );
        return;
      }

      const rawTokens = await this.fetchRawTokens(
        evmChainIds,
        mockErc20Address,
      );
      const tokens = this.mapToUpsertTokens(rawTokens, evmChains);
      const upsertedTokens = await this.upsertTokens(tokens);

      if (!upsertedTokens) return;

      const tokensByNetwork = this.groupTokensByNetwork(
        upsertedTokens,
        evmChains,
      );
      await this.cacheTokensByNetwork(tokensByNetwork);
    } catch (err) {
      this.logger.error('Token list update failed:', err);
    }
  }

  private getMockErc20Address(): string | undefined {
    return this.configService.get<string>('HARDCODED_MOCK_ERC20_ADDRESS');
  }

  private async fetchEvmChains(): Promise<EvmChain[] | null> {
    const { data, error } = await this.supabaseService.client
      .from('chains')
      .select('id, networkId')
      .eq('networkType', 'evm');

    if (error) {
      this.logger.error('Failed to fetch EVM chains from database', error);
      return null;
    }

    return data as EvmChain[];
  }

  private async fetchRawTokens(
    evmChainIds: string[],
    mockErc20Address?: string,
  ): Promise<ResponseToken[]> {
    const liFiTokens = (
      await this.httpService.axiosRef.get<TokenListResponse>(
        `${this.tokenListUrl}${evmChainIds.join(',')}`,
      )
    ).data.tokens;

    const rawTokensByChain = {
      ...liFiTokens,
      ...(mockErc20Address && tokensMock(mockErc20Address)),
    };

    return Object.values(rawTokensByChain).flat();
  }

  private mapToUpsertTokens(
    rawTokens: ResponseToken[],
    evmChains: EvmChain[],
  ): Token[] {
    const chainByNetworkId = new Map(evmChains.map((c) => [c.networkId, c]));

    return rawTokens
      .map((token) => {
        const chain = chainByNetworkId.get(token.chainId.toString());

        if (!chain) return null;

        const addr = validAddress(token.address);
        if (!addr) return null;

        return {
          chainId: chain.id,
          address: addr,
          symbol: token.symbol,
          decimals: token.decimals,
          name: token.name,
          logoURI: token.logoURI,
        };
      })
      .filter((token): token is Token => token !== null);
  }

  private async upsertTokens(tokens: Token[]): Promise<Token[] | null> {
    const { data, error } = await this.supabaseService.client
      .from('tokens')
      .upsert(tokens, { onConflict: 'chainId,address' })
      .select('*');

    if (error) {
      this.logger.error('Error upserting tokens:', error);
      return null;
    }

    return data as Token[];
  }

  private groupTokensByNetwork(
    tokens: Token[],
    evmChains: EvmChain[],
  ): Record<string, Token[]> {
    const networkIdById = new Map(evmChains.map((c) => [c.id, c.networkId]));
    const tokensByNetwork: Record<string, Token[]> = {};

    for (const token of tokens) {
      const networkId = networkIdById.get(token.chainId);
      if (!networkId) continue;

      if (!tokensByNetwork[networkId]) tokensByNetwork[networkId] = [];

      tokensByNetwork[networkId].push(token);
    }

    return tokensByNetwork;
  }

  private async cacheTokensByNetwork(
    tokensByNetwork: Record<string, Token[]>,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();

    for (const [networkId, tokens] of Object.entries(tokensByNetwork)) {
      pipeline.set(
        `${this.redisKeyPrefix}${networkId}`,
        JSON.stringify(tokens),
        'EX',
        24 * 60 * 60,
      );
    }

    await pipeline.exec();
  }

  private parseTokens(cached: string, chainId: string): ResponseToken[] | null {
    try {
      return JSON.parse(cached) as ResponseToken[];
    } catch {
      this.logger.warn(
        `Failed to parse token list for networkId ${chainId} from Redis, refetching...`,
      );
      return null;
    }
  }

  async getTokens(networkId: string): Promise<ResponseToken[]> {
    const redisKey = `${this.redisKeyPrefix}${networkId}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      const parsed = this.parseTokens(cached, networkId);
      if (parsed) return parsed;
    }

    await this.fetchTokenList();
    const refreshed = await this.redis.get(redisKey);
    if (!refreshed) return [];

    return this.parseTokens(refreshed, networkId) ?? [];
  }
}
