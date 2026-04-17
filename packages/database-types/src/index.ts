// Re-export main corrected type
export type { Database } from './database';

// Address branded type and utilities
export type { Address } from './address';
export { validAddress, isAddress, asAddress } from './address';

// Re-export Supabase's generated helper types
export type { Tables, TablesInsert, TablesUpdate, Enums } from './generated';
