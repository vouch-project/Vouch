// Re-export main corrected type
export type { Database } from './database';

// Address branded type and utilities
export type { Address } from './address';
export { validAddress, isAddress, asAddress } from './address';

// Corrected row helper types — use Database (with MergeDeep overrides) not the raw generated types
import type { Database } from './database';
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];

// Enums are unaffected by overrides — safe to re-export from generated
export type { Enums } from './generated';
