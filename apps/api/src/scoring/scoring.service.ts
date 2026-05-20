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

// Wire format from ml-engine (Python/Pydantic snake_case)
interface MlEngineResponse {
  address: string;
  score: number;
  confidence: number;
  model_version: string;
  factors: string[];
  explanation: string | null;
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
    return this.fetchAndPersistScore(normalized);
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
      explanation: data.explanation,
      computedAt: data.computedAt as string,
    };
  }

  private async fetchAndPersistScore(
    address: string,
  ): Promise<CreditScoreResponseDto> {
    let mlData: MlEngineResponse;

    try {
      const response = await firstValueFrom(
        this.httpService.get<MlEngineResponse>(
          `/api/v1/score/${encodeURIComponent(address)}`,
        ),
      );
      mlData = response.data;
    } catch (err) {
      this.logger.error(`ml-engine call failed for ${address}: ${String(err)}`);
      throw new ServiceUnavailableException(
        'Credit scoring service unavailable',
      );
    }

    const computedAt = new Date().toISOString();
    const { error } = await this.supabaseService.client
      .from('credit_scores')
      .insert({
        address,
        score: mlData.score,
        confidence: mlData.confidence,
        modelVersion: mlData.model_version,
        factors: mlData.factors,
        explanation: mlData.explanation,
        computedAt,
      });

    if (error)
      this.logger.error(`Failed to persist credit score: ${error.message}`);

    return {
      address,
      score: mlData.score,
      confidence: mlData.confidence,
      modelVersion: mlData.model_version,
      factors: mlData.factors,
      explanation: mlData.explanation,
      computedAt,
    };
  }
}
