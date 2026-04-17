import type { Tables } from './generated';

/**
 * Extended Loan type with joined token data.
 * Used in frontend queries that LEFT JOIN loans with tokens.
 * Fields are null (not absent) when no related token exists.
 */
export type LoanWithTokens = Tables<'loans'> & {
  collateralToken: Tables<'tokens'> | null;
  principalToken: Tables<'tokens'> | null;
};
