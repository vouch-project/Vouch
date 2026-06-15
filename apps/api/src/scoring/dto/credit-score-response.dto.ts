export class CreditScoreResponseDto {
  address: string;
  score: number;
  confidence: number;
  modelVersion: string;
  strengths: string[];
  riskFactors: string[];
  improvements: string[];
  explanation: string | null;
  computedAt: string;
}
