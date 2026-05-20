import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { CreditScoreResponseDto } from './dto/credit-score-response.dto';

const SCORE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async getCreditScore(walletAddress: string): Promise<CreditScoreResponseDto> {
    const normalized = walletAddress.toLowerCase();
    const cached = await this.getCachedScore(normalized);
    if (cached) return cached;
    return this.fetchScore(normalized);
  }

  private async getCachedScore(
    address: string,
  ): Promise<CreditScoreResponseDto | null> {
    const { data, error } = await this.supabaseService.client
      .from('credit_scores_latest')
      .select('*')
      .eq('address', address)
      .single();

    if (error || !data) return null;

    const computedAt = new Date(data.computedAt as string).getTime();
    if (Date.now() - computedAt > SCORE_TTL_MS) return null;

    return {
      address: data.address as string,
      score: data.score as number,
      confidence: data.confidence as number,
      modelVersion: data.modelVersion as string,
      factors: data.factors as string[],
      explanation: data.explanation as string | null,
      computedAt: data.computedAt as string,
    };
  }

  private async fetchScore(address: string): Promise<CreditScoreResponseDto> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<CreditScoreResponseDto>(
          `/api/v1/score/${encodeURIComponent(address)}`,
        ),
      );
      return response.data;
    } catch (err) {
      this.logger.error(`ml-engine call failed for ${address}: ${String(err)}`);
      throw new ServiceUnavailableException(
        'Credit scoring service unavailable',
      );
    }
  }
}
