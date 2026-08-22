import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceFeedService, priceKey } from '../tokens/price-feed.service';

export type ProtocolStats = {
  activeLoansCount: number;
  tvlUsd: number;
  totalBorrowedUsd: number;
};

@Injectable()
export class StatsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly priceFeedService: PriceFeedService,
  ) {}

  async getProtocolStats(): Promise<ProtocolStats> {
    const { data, error } = await this.supabaseService.client
      .from('loans')
      .select(
        `
        collateralAmount,
        collateralToken:tokens!loans_collateralTokenId_fkey(
          chainId, address, decimals
        ),
        principalAmount,
        principalToken:tokens!loans_principalTokenId_fkey(
          chainId, address, decimals
        )
      `,
      )
      .eq('status', 'active');

    if (error || !data) {
      return { activeLoansCount: 0, tvlUsd: 0, totalBorrowedUsd: 0 };
    }

    const prices = await this.priceFeedService.getPrices();

    const getPrice = (
      token: {
        chainId: string;
        address: string;
        decimals: number;
      } | null,
    ): { decimals: number; priceUsd: number } | null => {
      if (!token) return null;
      const price = prices[priceKey(token.chainId, token.address)];
      if (price == null) return null;
      return { decimals: token.decimals, priceUsd: price };
    };

    let tvlUsd = 0;
    let totalBorrowedUsd = 0;

    for (const loan of data) {
      const col = getPrice(
        loan.collateralToken as Parameters<typeof getPrice>[0],
      );
      const pri = getPrice(
        loan.principalToken as Parameters<typeof getPrice>[0],
      );

      if (loan.collateralAmount && col) {
        tvlUsd +=
          (Number(loan.collateralAmount) / 10 ** col.decimals) * col.priceUsd;
      }
      if (loan.principalAmount && pri) {
        totalBorrowedUsd +=
          (Number(loan.principalAmount) / 10 ** pri.decimals) * pri.priceUsd;
      }
    }

    return { activeLoansCount: data.length, tvlUsd, totalBorrowedUsd };
  }
}
