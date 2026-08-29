// Re-export database types from shared package
export type { Database, Enums, Tables } from '@vouch/database-types';
export type { LoanFull, LoanWithTokens } from '@vouch/database-types/helpers';

// Web-specific types
export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export type SignedRequestDashRow = {
  id: string;
  digest: string;
  borrowerAddress: string;
  collateralAmount: string;
  principalAmount: string;
  interestRateBps: number;
  duration: string;
  maxLtvBps: number;
  nonce: string;
  deadline: string;
  signature: string;
  status: string;
  collateralToken: { symbol: string; decimals: number; address: string } | null;
  principalToken: { symbol: string; decimals: number; address: string } | null;
};
