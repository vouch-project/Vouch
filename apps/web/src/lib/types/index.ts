// Re-export database types from shared package
export type { Database, Enums, Tables } from '@vouch/database-types';
export type { LoanFull, LoanWithTokens } from '@vouch/database-types/helpers';

// Web-specific types
export type UUID = `${string}-${string}-${string}-${string}-${string}`;
