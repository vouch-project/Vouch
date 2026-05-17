export type RiskLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

export class CreditScoreResponseDto {
  walletAddress: string;
  score: number;
  confidence: number;
  riskLevel: RiskLevel;
  factors: string[];
  modelVersion: string;
  scoredAt: string;
}
