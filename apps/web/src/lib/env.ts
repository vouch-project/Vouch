import { env } from '$env/dynamic/public';

export const SUPABASE_URL = env.PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const REOWN_PROJECT_ID = env.PUBLIC_REOWN_PROJECT_ID ?? '';
export const BACKEND_API_URL = env.PUBLIC_BACKEND_API_URL ?? 'http://localhost:3000';
export const VOUCH_VAULT_ADDRESS = env.PUBLIC_VOUCH_VAULT_ADDRESS ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3';
