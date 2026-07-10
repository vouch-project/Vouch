import { InjectRedis } from '@nestjs-modules/ioredis';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Tables, validAddress } from '@vouch/database-types';
import type { UUID } from 'crypto';
import type { Redis } from 'ioredis';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceFeedService, priceKey } from './price-feed.service';
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
  priceUsd: number | null;
  volatility: number | null;
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

// Mirrors the CASE seed in supabase/migrations/20260627000000_tokens_price_feed.sql.
// That migration only backfills rows that already exist at migration time; any
// token TokensService syncs in afterward (the normal case — this runs on every
// API startup and daily via cron) would otherwise keep volatility NULL forever,
// silently falling back to the frontend's generic default instead of a
// token-specific value. Keep these two lists in sync.
const DEFAULT_VOLATILITY_BY_SYMBOL: Record<string, number> = {
  USDC: 0.02,
  USDT: 0.03,
  DAI: 0.04,
  ETH: 0.45,
  WETH: 0.45,
  BTC: 0.5,
  WBTC: 0.5,
  LINK: 0.7,
  UNI: 0.75,
  AAVE: 0.65,
  MOCK: 0.25,
};
const DEFAULT_VOLATILITY = 0.6;

// Caps how many token updates run concurrently so a large Li.Fi token list
// (hundreds/thousands of tokens) doesn't fire that many simultaneous requests
// at PostgREST/DB on every API startup and daily cron run.
const BACKFILL_CONCURRENCY = 10;

const runWithConcurrencyLimit = async <T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> => {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
};

// Testnets whose networkId prefix in RouteScan is "testnet" rather than "mainnet".
const TESTNET_CHAIN_IDS = new Set(['11155111', '84532', '80002', '43113']);

type RouteScanErc20Token = {
  chainId: number;
  address: string;
  name: string | null;
  symbol: string;
  decimals: number;
};

type RouteScanErc20Response = {
  items: RouteScanErc20Token[];
  link?: { next?: string };
};

@Injectable()
export class TokensService implements OnModuleInit {
  private readonly logger = new Logger(TokensService.name);
  private readonly routeScanBase = 'https://api.routescan.io/v2/network';
  private readonly redisKeyPrefix = 'tokens:cache:';

  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly priceFeedService: PriceFeedService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    await this.fetchTokenList();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  private async fetchTokenList() {
    this.logger.log('Fetching token list from RouteScan...');
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

      await this.backfillVolatility(upsertedTokens);

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

  private async getChainIdByNetworkId(networkId: string): Promise<UUID | null> {
    const { data, error } = await this.supabaseService.client
      .from('chains')
      .select('id')
      .eq('networkId', networkId)
      .single();

    if (error || !data) return null;
    return data.id;
  }

  private routeScanNetworkId(chainId: string): string {
    return TESTNET_CHAIN_IDS.has(chainId) ? 'testnet' : 'mainnet';
  }

  private async fetchRouteScanTokens(
    chainId: string,
  ): Promise<ResponseToken[]> {
    const networkId = this.routeScanNetworkId(chainId);
    const tokens: ResponseToken[] = [];
    let nextUrl: string | undefined =
      `${this.routeScanBase}/${networkId}/evm/${chainId}/erc20?limit=100`;

    while (nextUrl) {
      const currentUrl: string = nextUrl;
      const res =
        await this.httpService.axiosRef.get<RouteScanErc20Response>(currentUrl);
      for (const t of res.data.items ?? []) {
        tokens.push({
          chainId: t.chainId,
          address: t.address,
          symbol: t.symbol,
          decimals: t.decimals,
          name: t.name ?? null,
          logoURI: null,
          priceUsd: null,
          volatility: null,
        });
      }
      nextUrl = res.data.link?.next;
    }

    return tokens;
  }

  private async fetchRawTokens(
    evmChainIds: string[],
    mockErc20Address?: string,
  ): Promise<ResponseToken[]> {
    // Skip local dev chain — RouteScan has no record of it.
    const routeScanChainIds = evmChainIds.filter((id) => id !== '1337');

    const results = await Promise.allSettled(
      routeScanChainIds.map((id) => this.fetchRouteScanTokens(id)),
    );

    const routeScanTokens: ResponseToken[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        routeScanTokens.push(...result.value);
      } else {
        this.logger.warn(
          `RouteScan fetch failed for chain ${routeScanChainIds[i]}: ${result.reason}`,
        );
      }
    }

    const mockTokens = mockErc20Address
      ? Object.values(tokensMock(mockErc20Address)).flat()
      : [];

    return [...routeScanTokens, ...mockTokens];
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

  /**
   * Sets a default volatility for any newly-synced token that doesn't have one
   * yet. Only targets rows still NULL (.is('volatility', null)), so a
   * manually-tuned value already in the DB is never overwritten. Updates are
   * scoped per (chainId, address) pair rather than batched .in() filters on
   * each column separately — the latter would match the cross product (e.g.
   * token A on chain X and token B on chain Y could wrongly also match
   * token A on chain Y) instead of the intended pairs.
   */
  private async backfillVolatility(tokens: Token[]): Promise<void> {
    await runWithConcurrencyLimit(
      tokens,
      BACKFILL_CONCURRENCY,
      async (token) => {
        const volatility =
          DEFAULT_VOLATILITY_BY_SYMBOL[token.symbol] ?? DEFAULT_VOLATILITY;
        const { error } = await this.supabaseService.client
          .from('tokens')
          .update({ volatility })
          .eq('chainId', token.chainId)
          .eq('address', token.address)
          .is('volatility', null);

        if (error) {
          this.logger.warn(
            `Failed to backfill volatility for ${token.symbol} on chain ${token.chainId}: ${error.message}`,
          );
        }
      },
    );
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

    let tokens: ResponseToken[] = [];
    if (cached) {
      const parsed = this.parseTokens(cached, networkId);
      if (parsed) tokens = parsed;
    }

    if (!tokens.length) {
      await this.fetchTokenList();
      const refreshed = await this.redis.get(redisKey);
      tokens = refreshed ? (this.parseTokens(refreshed, networkId) ?? []) : [];
    }

    // Enrich with live prices and volatility from DB. Both are scoped by the DB's
    // uuid chainId (not `ResponseToken.chainId`, which is the raw numeric chain id
    // from the Li.Fi token list) so tokens with the same symbol/address on different
    // chains never collide.
    const dbChainId = await this.getChainIdByNetworkId(networkId);
    if (!dbChainId)
      return tokens.map((t) => ({ ...t, priceUsd: null, volatility: null }));

    const prices = await this.priceFeedService.getPrices();

    const tokenAddresses = tokens
      .map((t) => validAddress(t.address))
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const { data: dbTokens } = await this.supabaseService.client
      .from('tokens')
      .select('address, price_usd, volatility')
      .eq('chainId', dbChainId)
      .in('address', tokenAddresses);

    const dbByAddress = new Map(
      (dbTokens ?? []).map((t) => [t.address.toLowerCase(), t]),
    );

    return tokens.map((t) => {
      const dbToken = dbByAddress.get(t.address.toLowerCase());
      return {
        ...t,
        priceUsd:
          prices[priceKey(dbChainId, t.address)] ?? dbToken?.price_usd ?? null,
        volatility: dbToken?.volatility ?? null,
      };
    });
  }
}
