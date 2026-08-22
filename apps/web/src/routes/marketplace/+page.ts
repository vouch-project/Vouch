import { axiosApi } from '$api/axiosApi';
import { supabase } from '$lib/supabase';
import type { LoanWithTokens } from '$lib/types';
import type { Address } from '@vouch/database-types';
import type { PageLoad } from './$types';
import type { LendOfferRow } from './_utils';

export const load: PageLoad = () => {
  const loansPromise: PromiseLike<LoanWithTokens[]> = supabase
    .from('loans')
    .select(
      `*, principalToken:tokens!loans_principalTokenId_fkey(*), collateralToken:tokens!loans_collateralTokenId_fkey(*)`,
    )
    .eq('status', 'pending')
    .or(`fundDeadline.is.null,fundDeadline.gt.${new Date().toISOString()}`)
    .order('createdAt', { ascending: false })
    .then(({ data, error }) => {
      if (error) throw error;
      return data ?? [];
    });

  // Chained off loansPromise so it runs client-side only (axiosApi reads localStorage).
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

  const lendOffersPromise: PromiseLike<LendOfferRow[]> = supabase
    .from('lend_offers')
    .select(`*, principalToken:tokens!lend_offers_principalTokenId_fkey(*)`)
    .eq('status', 'pending')
    .gt('acceptDeadline', new Date().toISOString())
    .order('createdAt', { ascending: false })
    .then(({ data, error }) => {
      if (error) throw error;
      return (data as unknown as LendOfferRow[]) ?? [];
    });

  return { streamed: { loansPromise, scoresPromise, lendOffersPromise } };
};
