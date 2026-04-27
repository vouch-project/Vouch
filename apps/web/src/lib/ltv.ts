/**
 * LTV (Loan-to-Value) calculation utilities.
 *
 * TODO: Migrate TOKEN_META to real data from the `tokens` table in the database.
 *   - priceUsd   → pull from a price-feed service (e.g. CoinGecko, Chainlink) and store/cache in DB
 *   - volatility → compute from historical price data and store per-token in DB
 *   These two fields should be added as columns to the tokens table (or a separate
 *   token_metadata table) and served via the API so LTV calculation stays server-authoritative.
 */

export interface TokenMeta {
  priceUsd: number;
  /** 0–1. Higher volatility = lower allowed LTV. */
  volatility: number;
}

// Volatility drives the base max-LTV: low-vol stables → 90%, high-vol assets → 50%.
// baseLTV = 90 - volatility * 40   (range: 50%–90%)
export const TOKEN_META: Record<string, TokenMeta> = {
  MOCK: { priceUsd: 1000, volatility: 0.25 },
  ETH: { priceUsd: 3200, volatility: 0.55 },
  WETH: { priceUsd: 3200, volatility: 0.55 },
  BTC: { priceUsd: 65000, volatility: 0.5 },
  WBTC: { priceUsd: 65000, volatility: 0.5 },
  USDC: { priceUsd: 1, volatility: 0.02 },
  USDT: { priceUsd: 1, volatility: 0.03 },
  DAI: { priceUsd: 1, volatility: 0.04 },
  LINK: { priceUsd: 18, volatility: 0.7 },
  UNI: { priceUsd: 12, volatility: 0.75 },
  AAVE: { priceUsd: 110, volatility: 0.65 },
};

export const DEFAULT_TOKEN_META: TokenMeta = { priceUsd: 1, volatility: 0.6 };

export const getTokenMeta = (symbol: string | null | undefined): TokenMeta =>
  TOKEN_META[symbol ?? ''] ?? DEFAULT_TOKEN_META;

/**
 * Base max-LTV for a token pair, driven by the higher volatility of the two legs.
 * We use the max because the riskier asset dominates the pair's collateral risk.
 *
 * baseLTV(v) = 90 − v × 40   →  range [50%, 90%]
 */
export const baseLtv = (
  collateralSymbol: string | null | undefined,
  borrowSymbol: string | null | undefined,
): number => {
  const v = Math.max(getTokenMeta(collateralSymbol).volatility, getTokenMeta(borrowSymbol).volatility);
  return 90 - v * 40;
};

/**
 * Credit-score multiplier applied on top of the base LTV.
 *   score 650 → 0.85×  (reduces LTV by 15%)
 *   score 750 → 0.975× (near-neutral)
 *   score 850 → 1.10×  (boosts LTV by 10%)
 *
 * Linear interpolation: mult = 0.85 + (score − 650) / 200 × 0.25
 */
export const scoreMult = (score: number | null | undefined): number => {
  if (score == null) return 1;
  const clamped = Math.max(650, Math.min(850, score));
  return 0.85 + ((clamped - 650) / 200) * 0.25;
};

/**
 * Final max LTV = base LTV adjusted by the borrower's credit score.
 */
export const maxLtv = (
  collateralSymbol: string | null | undefined,
  borrowSymbol: string | null | undefined,
  score: number | null | undefined,
): number => baseLtv(collateralSymbol, borrowSymbol) * scoreMult(score);
