import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceFeedService, priceKey } from '../tokens/price-feed.service';

export type ProtocolStats = {
  activeLoansCount: number;
  tvlUsd: number;
  totalBorrowedUsd: number;
};

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

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
      this.logger.error('Failed to fetch active loans for stats', error);
      throw error ?? new Error('No data returned from loans query');
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

    // Convert a raw token amount (stored as text bigint) to a USD value without
    // precision loss. Number(rawAmount) overflows for large uint256 values, so
    // we do the integer division in bigint space first, then convert each part.
    const toUsd = (
      rawAmount: string,
      decimals: number,
      priceUsd: number,
    ): number => {
      const scale = BigInt(10) ** BigInt(decimals);
      const raw = BigInt(rawAmount);
      const whole = Number(raw / scale);
      const frac = Number(raw % scale) / 10 ** decimals;
      return (whole + frac) * priceUsd;
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
        tvlUsd += toUsd(loan.collateralAmount, col.decimals, col.priceUsd);
      }
      if (loan.principalAmount && pri) {
        totalBorrowedUsd += toUsd(
          loan.principalAmount,
          pri.decimals,
          pri.priceUsd,
        );
      }
    }

    return { activeLoansCount: data.length, tvlUsd, totalBorrowedUsd };
  }
}
