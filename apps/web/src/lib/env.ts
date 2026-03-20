import { env } from '$env/dynamic/public';

export const PUBLIC_SUPABASE_URL = env.PUBLIC_SUPABASE_URL ?? '';
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const PUBLIC_REOWN_PROJECT_ID = env.PUBLIC_REOWN_PROJECT_ID ?? '';
export const BACKEND_API_URL = env.PUBLIC_BACKEND_API_URL ?? 'http://localhost:3000';
