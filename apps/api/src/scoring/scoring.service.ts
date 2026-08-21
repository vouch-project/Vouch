import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { asAddress } from '@vouch/database-types';
import { ethers } from 'ethers';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { CreditScoreResponseDto } from './dto/credit-score-response.dto';

const ATTESTATION_TTL_S = 5 * 60; // 5 minutes

const SCORE_TTL_MS = 24 * 60 * 60 * 1000;

// Wire format from ml-engine (Python/Pydantic snake_case)
interface MlEngineResponse {
  address: string;
  score: number;
  confidence: number;
  model_version: string;
  strengths: string[];
  risk_factors: string[];
  improvements: string[];
  explanation: string | null;
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async getCreditScore(walletAddress: string): Promise<CreditScoreResponseDto> {
    let address: string;
    try {
      address = asAddress(walletAddress);
    } catch {
      throw new BadRequestException('Invalid wallet address');
    }
    const cached = await this.getCachedScore(address);
    if (cached) return cached;
    return this.fetchAndPersistScore(address);
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

    const factors = data.factors as {
      strengths: string[];
      risk_factors: string[];
      improvements: string[];
    } | null;
    return {
      address: data.address as string,
      score: data.score as number,
      confidence: data.confidence as number,
      modelVersion: data.modelVersion as string,
      strengths: factors?.strengths ?? [],
      riskFactors: factors?.risk_factors ?? [],
      improvements: factors?.improvements ?? [],
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
        address: asAddress(address),
        score: mlData.score,
        confidence: mlData.confidence,
        modelVersion: mlData.model_version,
        factors: {
          strengths: mlData.strengths,
          risk_factors: mlData.risk_factors,
          improvements: mlData.improvements,
        },
        explanation: mlData.explanation,
        computedAt,
      });

    // best-effort: return score to caller even if persistence fails
    if (error)
      this.logger.error(`Failed to persist credit score: ${error.message}`);

    return {
      address,
      score: mlData.score,
      confidence: mlData.confidence,
      modelVersion: mlData.model_version,
      strengths: mlData.strengths,
      riskFactors: mlData.risk_factors,
      improvements: mlData.improvements,
      explanation: mlData.explanation,
      computedAt,
    };
  }

  async getAttestation(
    walletAddress: string,
  ): Promise<{ score: number; expiry: number; sig: string }> {
    const privateKey = this.configService.get<string>(
      'SCORE_SIGNER_PRIVATE_KEY',
    );
    if (!privateKey) {
      throw new ServiceUnavailableException('Score attestation not configured');
    }

    const { score, address: normalizedAddress } =
      await this.getCreditScore(walletAddress);
    const expiry = Math.floor(Date.now() / 1000) + ATTESTATION_TTL_S;

    const msgHash = ethers.solidityPackedKeccak256(
      ['address', 'uint16', 'uint256'],
      [normalizedAddress, score, expiry],
    );
    const wallet = new ethers.Wallet(privateKey);
    const sig = await wallet.signMessage(ethers.getBytes(msgHash));

    return { score, expiry, sig };
  }
}
