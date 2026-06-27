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
      if (token.priceUsd != null && token.volatility != null) {
        next[token.symbol] = { priceUsd: token.priceUsd, volatility: token.volatility };
      }
    }
    this.map = next;
  }
}

export const tokenPrices = new TokenPrices();
