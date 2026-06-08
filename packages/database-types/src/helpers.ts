import type { Database } from './database';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

/**
 * Extended Loan type with joined token data.
 * Used in frontend queries that LEFT JOIN loans with tokens.
 * Fields are null (not absent) when no related token exists.
 */
export type LoanWithTokens = Row<'loans'> & {
  collateralToken: Row<'tokens'> | null;
  principalToken: Row<'tokens'> | null;
};

/**
 * LoanWithTokens further extended with repayment transactions.
 * Used in the dashboard to show repayment progress from the DB.
 */
export type LoanFull = LoanWithTokens & {
  repaymentTransactions: Pick<Row<'transactions'>, 'id' | 'amount' | 'txTimestamp' | 'txHash'>[];
};
