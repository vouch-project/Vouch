import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '$lib/env';
import { createClient } from '@supabase/supabase-js';

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
