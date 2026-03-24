import { supabase } from '$lib/supabase';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  return {
    streamed: {
      loansPromise: supabase
        .from('loans')
        .select(`*, token_list (*)`)
        .order('createdAt', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw error;

          return data ?? [];
        }),
    },
  };
};
