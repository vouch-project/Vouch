import { Controller, Get, Param } from '@nestjs/common';
import { CreditScoreResponseDto } from './dto/credit-score-response.dto';
import { ScoringService } from './scoring.service';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get(':address')
  getCreditScore(
    @Param('address') address: string,
  ): Promise<CreditScoreResponseDto> {
    return this.scoringService.getCreditScore(address);
  }

  @Get(':address/attestation')
  getAttestation(
    @Param('address') address: string,
  ): Promise<{ score: number; expiry: number; sig: string }> {
    return this.scoringService.getAttestation(address);
  }
}
