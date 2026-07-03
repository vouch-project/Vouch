/**
 * LTV (Loan-to-Value) calculation utilities.
 *
 * Token prices and volatility are now served by the API (sourced from Chainlink
 * price feeds). Use the `tokenPrices` store to get TokenMeta for a given symbol.
 * Volatility is maintained as a DB column (manually set, future: computed from
 * historical price data via ATR/rolling std dev).
 */

export interface TokenMeta {
  priceUsd: number;
  /** 0–1. Higher volatility = lower allowed LTV. */
  volatility: number;
}

// Volatility drives the base max-LTV: low-vol stables → 90%, high-vol assets → 50%.
// baseLTV = 90 - volatility * 40   (range: 50%–90%)
export const baseLtv = (collateralMeta: TokenMeta, borrowMeta: TokenMeta): number => {
  const v = Math.max(collateralMeta.volatility, borrowMeta.volatility);
  return 90 - v * 40;
};

/**
 * Credit-score multiplier applied on top of the base LTV.
 * score 300 → 0.50×, score 770 → 1.00×, score 850 → 1.10×
 */
export const scoreMult = (score: number | null | undefined): number => {
  if (score == null) return 1;
  const clamped = Math.max(300, Math.min(850, score));
  return 0.5 + ((clamped - 300) / 550) * 0.6;
};

/** Final max LTV = base LTV adjusted by the borrower's credit score. */
export const maxLtv = (
  collateralMeta: TokenMeta,
  borrowMeta: TokenMeta,
  score: number | null | undefined,
): number => baseLtv(collateralMeta, borrowMeta) * scoreMult(score);
