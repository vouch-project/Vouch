import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreditScoreResponseDto,
  RiskLevel,
} from './dto/credit-score-response.dto';

const SCORE_TTL_MS = 24 * 60 * 60 * 1000;

interface MlScoreResponse {
  address: string;
  score: number;
  confidence: number;
  risk_level: RiskLevel;
  factors: string[];
  model_version: string;
}

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

    return this.fetchAndCacheScore(normalized);
  }

  private async getCachedScore(
    walletAddress: string,
  ): Promise<CreditScoreResponseDto | null> {
    const { data, error } = await this.supabaseService.client
      .from('credit_scores')
      .select('*')
      .eq('walletAddress', walletAddress)
      .single();

    if (error || !data) return null;

    const scoredAt = new Date(data.scoredAt).getTime();
    if (Date.now() - scoredAt > SCORE_TTL_MS) return null;

    return {
      walletAddress: data.walletAddress,
      score: data.score,
      confidence: data.confidence,
      riskLevel: data.riskLevel as RiskLevel,
      factors: data.factors as string[],
      modelVersion: data.modelVersion,
      scoredAt: data.scoredAt,
    };
  }

  private async fetchAndCacheScore(
    walletAddress: string,
  ): Promise<CreditScoreResponseDto> {
    let mlData: MlScoreResponse;

    try {
      const response = await firstValueFrom(
        this.httpService.get<MlScoreResponse>(
          `/api/v1/score/${encodeURIComponent(walletAddress)}`,
        ),
      );
      mlData = response.data;
    } catch (err) {
      this.logger.error(
        `ml-engine call failed for ${walletAddress}: ${String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Credit scoring service unavailable',
      );
    }

    const now = new Date().toISOString();
    const { error } = await this.supabaseService.client
      .from('credit_scores')
      .upsert(
        {
          walletAddress,
          score: mlData.score,
          confidence: mlData.confidence,
          riskLevel: mlData.risk_level,
          factors: mlData.factors,
          modelVersion: mlData.model_version,
          scoredAt: now,
        },
        { onConflict: 'walletAddress' },
      );

    if (error)
      this.logger.error(`Failed to cache credit score: ${error.message}`);

    return {
      walletAddress,
      score: mlData.score,
      confidence: mlData.confidence,
      riskLevel: mlData.risk_level,
      factors: mlData.factors,
      modelVersion: mlData.model_version,
      scoredAt: now,
    };
  }
}
