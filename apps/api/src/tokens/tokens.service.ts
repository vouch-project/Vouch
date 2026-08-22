import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { asAddress, Tables, validAddress } from '@vouch/database-types';
import type { UUID } from 'crypto';
import { ethers } from 'ethers';
import type { Redis } from 'ioredis';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceFeedService, priceKey } from './price-feed.service';
import { sepoliaTokensMock, tokensMock } from './tokens.mock';

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
  priceFeedAddress: string | null;
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

// Caps how many token updates run concurrently so the backfill doesn't fire that
// many simultaneous requests at PostgREST/DB on every API startup and cron run.
const BACKFILL_CONCURRENCY = 10;

// Rows per PostgREST upsert batch — keeps request sizes manageable.
const UPSERT_BATCH_SIZE = 500;

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

@Injectable()
export class TokensService implements OnModuleInit {
  private readonly logger = new Logger(TokensService.name);
  private readonly redisKeyPrefix = 'tokens:cache:';

  constructor(
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
    this.logger.log('Token sync started');
    try {
      const mockErc20Address = this.getMockErc20Address();
      const evmChains = await this.fetchEvmChains();

      if (!evmChains) {
        return;
      }

      const evmChainIds = evmChains.map((chain) => chain.networkId);
      if (evmChainIds.length === 0) {
        this.logger.warn('No EVM chains in database, skipping token sync');
        return;
      }

      this.logger.log(
        `Syncing tokens for ${evmChainIds.length} chain(s): ${evmChainIds.join(', ')}`,
      );

      const rawTokens = this.fetchRawTokens(mockErc20Address);
      this.logger.log(`Collected ${rawTokens.length} token(s) to sync`);

      const tokens = this.mapToUpsertTokens(rawTokens, evmChains);
      this.logger.log(
        `${tokens.length} tokens mapped (${rawTokens.length - tokens.length} dropped — unknown chain or invalid address)`,
      );

      const upsertedTokens = await this.upsertTokens(tokens);
      if (!upsertedTokens) return;
      this.logger.log(`Upserted ${upsertedTokens.length} tokens to database`);

      await this.backfillVolatility(upsertedTokens);

      const tokensByNetwork = this.groupTokensByNetwork(
        upsertedTokens,
        evmChains,
      );
      await this.cacheTokensByNetwork(tokensByNetwork);

      for (const [networkId, networkTokens] of Object.entries(
        tokensByNetwork,
      )) {
        this.logger.log(
          `Cached ${networkTokens.length} tokens for chain ${networkId}`,
        );
      }

      this.logger.log('Token sync complete');
    } catch (err) {
      this.logger.error(
        'Token sync failed:',
        err instanceof Error ? err.stack : JSON.stringify(err),
      );
    }
  }

  private getMockErc20Address(): string | undefined {
    return this.configService.get<string>('HARDCODED_MOCK_ERC20_ADDRESS');
  }

  /**
   * Mock ERC20s deployed to Sepolia and wired to real Chainlink feeds, written
   * by the contracts package's deploy-sepolia-mock-tokens script.
   */
  private getSepoliaMockTokens(): ResponseToken[] {
    const serialised = this.configService.get<string>('SEPOLIA_MOCK_TOKENS');
    if (!serialised) return [];

    try {
      return sepoliaTokensMock(serialised);
    } catch (err) {
      this.logger.warn(
        `Ignoring SEPOLIA_MOCK_TOKENS — could not parse: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
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

  /**
   * The token universe is now defined entirely by what we deploy and wire to a
   * Chainlink feed: the local MockERC20, and the Sepolia mocks from
   * `packages/contracts/scripts/deploy-sepolia-mock-tokens.ts`.
   *
   * Third-party token discovery (previously RouteScan) was removed because it
   * returned thousands of tokens with no price feed, which the frontend then
   * rendered at its $1 fallback price and the vault accepted as collateral
   * without any LTV check. Revisit when a mainnet chain is configured.
   */
  private fetchRawTokens(mockErc20Address?: string): ResponseToken[] {
    const ethFeedAddress = this.configService.get<string>(
      'LOCAL_ETH_FEED_ADDRESS',
    );
    const mockFeedAddress = this.configService.get<string>(
      'LOCAL_MOCK_FEED_ADDRESS',
    );
    const mockTokens = mockErc20Address
      ? Object.values(
          tokensMock(mockErc20Address, ethFeedAddress, mockFeedAddress),
        ).flat()
      : [];

    if (mockTokens.length) {
      this.logger.log(
        `Injected ${mockTokens.length} mock token(s) for local chain`,
      );
    }

    const sepoliaMockTokens = this.getSepoliaMockTokens();
    if (sepoliaMockTokens.length) {
      this.logger.log(
        `Injected ${sepoliaMockTokens.length} mock token(s) for Sepolia`,
      );
    }

    return [...mockTokens, ...sepoliaMockTokens];
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

        // Drop tokens with no feed — they cannot be priced and the column is NOT NULL.
        if (!token.priceFeedAddress) return null;

        return {
          chainId: chain.id,
          address: addr,
          symbol: token.symbol,
          decimals: token.decimals,
          name: token.name,
          logoURI: token.logoURI,
          price_feed_address: token.priceFeedAddress,
        };
      })
      .filter((token): token is Token => token !== null);
  }

  private async upsertTokens(tokens: Token[]): Promise<Token[] | null> {
    // Tokens with a real Chainlink feed address get a full upsert (all columns updated).
    // Tokens with ZeroAddress feed use insert-only (ignoreDuplicates) so that a feed
    // address previously set by deploy-mock-aggregators.ts is never overwritten on
    // subsequent API restarts or cron runs.
    const withFeed = tokens.filter(
      (t) => t.price_feed_address !== ethers.ZeroAddress,
    );
    const withoutFeed = tokens.filter(
      (t) => t.price_feed_address === ethers.ZeroAddress,
    );

    const results: Token[] = [];

    for (const [batch_tokens, ignoreDuplicates] of [
      [withFeed, false],
      [withoutFeed, true],
    ] as [Token[], boolean][]) {
      for (let i = 0; i < batch_tokens.length; i += UPSERT_BATCH_SIZE) {
        const batch = batch_tokens.slice(i, i + UPSERT_BATCH_SIZE);
        const { data, error } = await this.supabaseService.client
          .from('tokens')
          .upsert(batch, { onConflict: 'chainId,address', ignoreDuplicates })
          .select('*');

        if (error) {
          this.logger.error(
            `Error upserting token batch ${i}–${i + batch.length - 1}: ${error.message}`,
            JSON.stringify(error),
          );
          return null;
        }

        const inserted = data as Token[];
        results.push(...inserted);

        // With ignoreDuplicates the response only contains newly inserted rows.
        // Fetch the already-existing rows so the rest of the pipeline sees them.
        // Group by chainId because a single batch can span multiple chains
        // (e.g. local + Sepolia mock tokens).
        if (ignoreDuplicates && inserted.length < batch.length) {
          const insertedAddrs = new Set(
            inserted.map((t) => t.address.toLowerCase()),
          );
          const existingTokens = batch.filter(
            (t) => !insertedAddrs.has(t.address.toLowerCase()),
          );

          const byChainId = new Map<string, string[]>();
          for (const t of existingTokens) {
            const chainId = t.chainId as string;
            if (!byChainId.has(chainId)) byChainId.set(chainId, []);
            byChainId.get(chainId)!.push(t.address);
          }

          for (const [chainId, addrs] of byChainId) {
            const { data: existing, error: fetchErr } =
              await this.supabaseService.client
                .from('tokens')
                .select('*')
                .eq('chainId', chainId as UUID)
                .in('address', addrs.map(asAddress));

            if (fetchErr) {
              this.logger.warn(
                `Failed to fetch existing tokens for chain ${chainId}: ${fetchErr.message}`,
              );
            } else {
              results.push(...(existing as Token[]));
            }
          }
        }

        this.logger.debug(
          `Upserted batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}/${Math.ceil(batch_tokens.length / UPSERT_BATCH_SIZE)} (${results.length}/${tokens.length} tokens)`,
        );
      }
    }

    return results;
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
    // Seed every known chain with an empty array so the returned map always has
    // an entry per chain. cacheTokensByNetwork skips writing chains with zero
    // tokens, so stale cache entries are not cleared for non-mock networks.
    const tokensByNetwork: Record<string, Token[]> = Object.fromEntries(
      evmChains.map((c) => [c.networkId, []]),
    );

    for (const token of tokens) {
      const networkId = networkIdById.get(token.chainId);
      if (!networkId) continue;
      tokensByNetwork[networkId].push(token);
    }

    return tokensByNetwork;
  }

  private async cacheTokensByNetwork(
    tokensByNetwork: Record<string, Token[]>,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();

    for (const [networkId, tokens] of Object.entries(tokensByNetwork)) {
      // Skip chains with no tokens so we don't overwrite a previously valid
      // cache entry with an empty list. fetchRawTokens() only knows about
      // mock networks (local + Sepolia); any other configured chain (e.g.
      // mainnet) would always produce zero tokens here and incorrectly clear
      // its cached data.
      if (tokens.length === 0) continue;
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
    // uuid chainId (not `ResponseToken.chainId`, which is the raw numeric chain id)
    // so tokens with the same symbol/address on different chains never collide.
    const dbChainId = await this.getChainIdByNetworkId(networkId);
    if (!dbChainId)
      return tokens.map((t) => ({ ...t, priceUsd: null, volatility: null }));

    const prices = await this.priceFeedService.getPrices();

    const tokenAddresses = tokens
      .map((t) => validAddress(t.address))
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const { data: dbTokens } = await this.supabaseService.client
      .from('tokens')
      .select('address, volatility, price_feed_address, chains(rpcUrl)')
      .eq('chainId', dbChainId)
      .in('address', tokenAddresses);

    const dbByAddress = new Map(
      (dbTokens ?? []).map((t) => [
        t.address.toLowerCase(),
        {
          volatility: t.volatility,
          priceFeedAddress: t.price_feed_address,
          rpcUrl: (t.chains as { rpcUrl: string } | null)?.rpcUrl ?? null,
        },
      ]),
    );

    // First pass: enrich from cache, collect misses
    const misses: Array<{
      token: ResponseToken;
      feedAddress: string;
      rpcUrl: string;
    }> = [];

    const enriched = tokens.map((t) => {
      const db = dbByAddress.get(t.address.toLowerCase());
      const cachedPrice = prices[priceKey(dbChainId, t.address)] ?? null;

      if (cachedPrice === null && db?.priceFeedAddress && db.rpcUrl) {
        misses.push({
          token: t,
          feedAddress: db.priceFeedAddress,
          rpcUrl: db.rpcUrl,
        });
      }

      return {
        ...t,
        priceUsd: cachedPrice,
        volatility: db?.volatility ?? null,
        priceFeedAddress: db?.priceFeedAddress ?? t.priceFeedAddress ?? null,
      };
    });

    // Second pass: fetch on-demand for cache misses, in parallel
    if (misses.length > 0) {
      const fetchedPrices = await Promise.all(
        misses.map(({ token, feedAddress, rpcUrl }) =>
          this.priceFeedService
            .getPriceForToken(dbChainId, token.address, feedAddress, rpcUrl)
            .then((price) => ({ address: token.address.toLowerCase(), price }))
            .catch(() => ({
              address: token.address.toLowerCase(),
              price: null,
            })),
        ),
      );

      const fetchedByAddress = new Map(
        fetchedPrices.map((r) => [r.address, r.price]),
      );

      return enriched.map((t) => ({
        ...t,
        priceUsd:
          t.priceUsd ?? fetchedByAddress.get(t.address.toLowerCase()) ?? null,
      }));
    }

    return enriched;
  }
}
