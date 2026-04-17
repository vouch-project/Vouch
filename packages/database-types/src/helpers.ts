import type { Tables } from './generated';

/**
 * Extended Loan type with joined token data
 * Used in frontend queries that join loans with tokens
 */
export type LoanWithTokens = Tables<'loans'> & {
  collateralToken?: Tables<'tokens'> | null;
  principalToken?: Tables<'tokens'> | null;
};
