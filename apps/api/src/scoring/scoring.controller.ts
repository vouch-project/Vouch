import { Controller, Get, Param } from '@nestjs/common';
import { ScoringService, type CreditScoreResult } from './scoring.service';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get(':address')
  getCreditScore(
    @Param('address') address: string,
  ): Promise<CreditScoreResult> {
    return this.scoringService.getCreditScore(address);
  }
}
