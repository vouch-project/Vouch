import { axiosApi } from '$api/axiosApi';
import { supabase } from '$lib/supabase';
import type { LoanWithTokens } from '$lib/types';
import type { Address } from '@vouch/database-types';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  // Supabase builder returns PromiseLike (a thenable), which SvelteKit's streamed accepts natively.
  // No need to wrap in Promise.resolve().
  const loansPromise: PromiseLike<LoanWithTokens[]> = supabase
    .from('loans')
    .select(
      `
      *,
      principalToken:tokens!loans_principalTokenId_fkey(*),
      collateralToken:tokens!loans_collateralTokenId_fkey(*)
    `,
    )
    .eq('status', 'pending')
    .order('createdAt', { ascending: false })
    .then(({ data, error }) => {
      if (error) throw error;
      return data ?? [];
    });

  // Fetch credit scores for all borrower addresses in parallel once loans resolve.
  // Chained off loansPromise so it runs client-side only (axiosApi reads localStorage).
  // Returns a map of address → score; Promise.allSettled ensures one failure doesn't block the rest.
  const scoresPromise: PromiseLike<Record<Address, number>> = loansPromise.then(async (loans) => {
    const addresses = [...new Set(loans.map((l) => l.borrowerAddress))];

    const results = await Promise.allSettled(
      addresses.map((address) =>
        axiosApi.get<{ score: number }>(`/scoring/${address}`).then(({ data }) => ({ address, score: data.score })),
      ),
    );

    return Object.fromEntries(
      results
        .filter((r): r is PromiseFulfilledResult<{ address: Address; score: number }> => r.status === 'fulfilled')
        .map((r) => [r.value.address, r.value.score]),
    );
  });

  return {
    streamed: {
      loansPromise,
      scoresPromise,
    },
  };
};
