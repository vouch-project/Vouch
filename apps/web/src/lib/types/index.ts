// Re-export database types from shared package
export type { Database, Tables, Enums } from '@vouch/database-types';
export type { LoanWithTokens } from '@vouch/database-types/helpers';

// Web-specific types
export type UUID = `${string}-${string}-${string}-${string}-${string}`;
