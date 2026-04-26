import { building } from '$app/environment';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '$lib/env';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@vouch/database-types';
import { JWT_STORAGE_KEY } from '../constants';

const isMissingEnv = !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY;

if (!building && isMissingEnv) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY env vars');
}

export const supabase = createClient<Database>(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_PUBLISHABLE_KEY || 'placeholder',
  {
    accessToken: async () => {
      // SvelteKit runs code universally (client + server).
      // We only access localStorage in the browser.
      if (typeof window !== 'undefined') return localStorage.getItem(JWT_STORAGE_KEY) ?? null;

      return null;
    },
  },
);
