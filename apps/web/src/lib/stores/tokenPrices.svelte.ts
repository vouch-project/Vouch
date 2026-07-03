import type { TokenMeta } from '$lib/ltv';
import { chainInfo } from './chainInfo.svelte';

export const DEFAULT_TOKEN_META: TokenMeta = { priceUsd: 1, volatility: 0.6 };

class TokenPrices {
  private map = $state<Record<string, TokenMeta>>({});

  getTokenMeta(symbol: string | null | undefined): TokenMeta {
    return this.map[symbol ?? ''] ?? DEFAULT_TOKEN_META;
  }

  sync() {
    const next: Record<string, TokenMeta> = {};
    for (const token of chainInfo.tokens) {
      // Fall back per-field rather than dropping the whole entry: volatility is
      // seeded in the DB immediately, but priceUsd only populates once the
      // PriceFeedService's first poll completes, so requiring both non-null would
      // wrongly discard a token's real seeded volatility during that window.
      if (token.priceUsd != null || token.volatility != null) {
        next[token.symbol] = {
          priceUsd: token.priceUsd ?? DEFAULT_TOKEN_META.priceUsd,
          volatility: token.volatility ?? DEFAULT_TOKEN_META.volatility,
        };
      }
    }
    this.map = next;
  }
}

export const tokenPrices = new TokenPrices();
