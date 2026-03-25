import { InjectRedis } from '@nestjs-modules/ioredis';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { Address, validAddress } from '../supabase/address';
import { SupabaseService } from '../supabase/supabase.service';
import { tokenListMock } from './tokens.mock';

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

export type Token = {
  chainId: Uuid;
  address: Address;
  symbol: string;
  decimals: number;
  name: string | null;
  logoURI: string | null;
};

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

type EvmChain = {
  id: Uuid;
  networkId: string;
};

@Injectable()
export class TokenListService implements OnModuleInit {
  private readonly logger = new Logger(TokenListService.name);
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
      .select('id, networkId::text')
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
      ...(mockErc20Address && tokenListMock(mockErc20Address)),
    };

    return Object.values(rawTokensByChain).flat();
  }

  private mapToUpsertTokens(
    rawTokens: ResponseToken[],
    evmChains: EvmChain[],
  ): Token[] {
    return rawTokens
      .map((token) => {
        const chain = evmChains.find(
          (evmChain) => evmChain.networkId === token.chainId.toString(),
        );

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
    const tokensByNetwork: Record<string, Token[]> = {};

    for (const token of tokens) {
      const chain = evmChains.find((evmChain) => evmChain.id === token.chainId);
      if (!chain) continue;

      if (!tokensByNetwork[chain.networkId])
        tokensByNetwork[chain.networkId] = [];

      tokensByNetwork[chain.networkId].push(token);
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

  private parseTokenList(
    cached: string,
    chainId: string,
  ): ResponseToken[] | null {
    try {
      return JSON.parse(cached) as ResponseToken[];
    } catch {
      this.logger.warn(
        `Failed to parse token list for networkId ${chainId} from Redis, refetching...`,
      );
      return null;
    }
  }

  async getTokenList(chainId: string): Promise<ResponseToken[]> {
    const redisKey = `${this.redisKeyPrefix}${chainId}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      const parsed = this.parseTokenList(cached, chainId);
      if (parsed) return parsed;
    }

    await this.fetchTokenList();
    const refreshed = await this.redis.get(redisKey);
    if (!refreshed) return [];

    return this.parseTokenList(refreshed, chainId) ?? [];
  }
}
