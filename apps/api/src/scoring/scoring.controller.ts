import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CreditScoreResponseDto } from './dto/credit-score-response.dto';
import { ScoringService } from './scoring.service';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get(':address')
  @UseGuards(JwtAuthGuard)
  getCreditScore(@Param('address') address: string): Promise<CreditScoreResponseDto> {
    return this.scoringService.getCreditScore(address);
  }
}
