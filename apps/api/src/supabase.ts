import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase admin client using the service-role key.
 * Use this for server-side operations that bypass RLS.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars',
      );
    }

    client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return client;
}
