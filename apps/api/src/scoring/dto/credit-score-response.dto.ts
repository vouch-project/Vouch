export class CreditScoreResponseDto {
  address: string;
  score: number;
  confidence: number;
  modelVersion: string;
  factors: string[];
  explanation: string | null;
  computedAt: string;
}
