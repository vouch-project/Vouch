import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
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
    @Query('contractAddress') contractAddress: string,
    @Query('chainId') chainId: string,
  ): Promise<{ score: number; expiry: number; sig: string }> {
    if (!contractAddress || !chainId) {
      throw new BadRequestException(
        'contractAddress and chainId query params are required',
      );
    }
    let chainIdBigInt: bigint;
    try {
      chainIdBigInt = BigInt(chainId);
    } catch {
      throw new BadRequestException('chainId must be an integer');
    }
    return this.scoringService.getAttestation(
      address,
      contractAddress,
      chainIdBigInt,
    );
  }

  @Get(':address/ltv-attestation')
  getLtvAttestation(
    @Param('address') address: string,
    @Query('collateralToken') collateralToken: string,
    @Query('borrowToken') borrowToken: string,
    @Query('contractAddress') contractAddress: string,
    @Query('chainId') chainId: string,
  ): Promise<{ maxLtvBps: number; expiry: number; sig: string }> {
    if (!collateralToken || !borrowToken || !contractAddress || !chainId) {
      throw new BadRequestException(
        'collateralToken, borrowToken, contractAddress, and chainId query params are required',
      );
    }
    let chainIdBigInt: bigint;
    try {
      chainIdBigInt = BigInt(chainId);
    } catch {
      throw new BadRequestException('chainId must be an integer');
    }
    if (chainIdBigInt <= 0n) {
      throw new BadRequestException('chainId must be a positive integer');
    }
    return this.scoringService.getLtvAttestation(
      address,
      collateralToken,
      borrowToken,
      contractAddress,
      chainIdBigInt,
    );
  }
}
