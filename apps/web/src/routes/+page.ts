import { supabase } from '$lib/supabase';
import type { PageLoad } from './$types';

export type ProtocolStats = { activeLoansCount: number; tvlUsd: number; totalBorrowedUsd: number };

export const load: PageLoad = () => {
  const statsPromise: Promise<ProtocolStats> = supabase
    .from('loans')
    .select(
      `
      collateralAmount,
      collateralToken:tokens!loans_collateralTokenId_fkey(decimals, price_usd),
      principalAmount,
      principalToken:tokens!loans_principalTokenId_fkey(decimals, price_usd)
    `,
    )
    .eq('status', 'active')
    .then(({ data, error }) => {
      if (error || !data) return { activeLoansCount: 0, tvlUsd: 0, totalBorrowedUsd: 0 };

      let tvlUsd = 0;
      let totalBorrowedUsd = 0;

      for (const loan of data) {
        const col = loan.collateralToken as { decimals: number; price_usd: number | null } | null;
        const pri = loan.principalToken as { decimals: number; price_usd: number | null } | null;

        if (loan.collateralAmount && col?.price_usd) {
          tvlUsd += (Number(loan.collateralAmount) / 10 ** col.decimals) * col.price_usd;
        }
        if (loan.principalAmount && pri?.price_usd) {
          totalBorrowedUsd += (Number(loan.principalAmount) / 10 ** pri.decimals) * pri.price_usd;
        }
      }

      return { activeLoansCount: data.length, tvlUsd, totalBorrowedUsd };
    });

  return { streamed: { statsPromise } };
};
