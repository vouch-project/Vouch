import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { CreditScoreResponseDto, RiskLevel } from './dto/credit-score-response.dto';

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
  private readonly mlEngineUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.mlEngineUrl =
      this.configService.get<string>('ML_ENGINE_URL') ?? 'http://localhost:8001';
  }

  async getCreditScore(walletAddress: string): Promise<CreditScoreResponseDto> {
    const cached = await this.getCachedScore(walletAddress);
    if (cached) return cached;

    return this.fetchAndCacheScore(walletAddress);
  }

  private async getCachedScore(walletAddress: string): Promise<CreditScoreResponseDto | null> {
    const { data, error } = await this.supabaseService.client
      .from('credit_scores')
      .select('*')
      .eq('walletAddress', walletAddress)
      .single();

    if (error || !data) return null;

    const scoredAt = new Date(data.scoredAt as string).getTime();
    if (Date.now() - scoredAt > SCORE_TTL_MS) return null;

    return {
      walletAddress: data.walletAddress as string,
      score: data.score as number,
      confidence: data.confidence as number,
      riskLevel: data.riskLevel as RiskLevel,
      factors: data.factors as string[],
      modelVersion: data.modelVersion as string,
      scoredAt: data.scoredAt as string,
    };
  }

  private async fetchAndCacheScore(walletAddress: string): Promise<CreditScoreResponseDto> {
    let mlData: MlScoreResponse;

    try {
      const response = await firstValueFrom(
        this.httpService.get<MlScoreResponse>(
          `${this.mlEngineUrl}/api/v1/score/${walletAddress}`,
        ),
      );
      mlData = response.data;
    } catch (err) {
      this.logger.error(`ml-engine call failed for ${walletAddress}: ${String(err)}`);
      throw new ServiceUnavailableException('Credit scoring service unavailable');
    }

    const now = new Date().toISOString();
    const { error } = await this.supabaseService.client.from('credit_scores').upsert({
      walletAddress,
      score: mlData.score,
      confidence: mlData.confidence,
      riskLevel: mlData.risk_level,
      factors: mlData.factors,
      modelVersion: mlData.model_version,
      scoredAt: now,
    });

    if (error) this.logger.error(`Failed to cache credit score: ${error.message}`);

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
