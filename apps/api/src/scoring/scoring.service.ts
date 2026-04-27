import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

export interface CreditScoreResult {
  address: string;
  score: number;
  confidence: number;
  factors: string[];
  message: string;
}

@Injectable()
export class ScoringService {
  constructor(private readonly httpService: HttpService) {}

  async getCreditScore(address: string): Promise<CreditScoreResult> {
    const { data } = await firstValueFrom(
      this.httpService.get<CreditScoreResult>(`/api/v1/score/${address}`),
    );

    return data;
  }
}
