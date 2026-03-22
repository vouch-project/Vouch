import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '$lib/env';
import { createClient } from '@supabase/supabase-js';
import { JWT_STORAGE_KEY } from '../constants';

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  accessToken: async () => {
    // SvelteKit runs code universally (client + server).
    // We only access localStorage in the browser.
    if (typeof window !== 'undefined') return localStorage.getItem(JWT_STORAGE_KEY) ?? null;

    return null;
  },
});
