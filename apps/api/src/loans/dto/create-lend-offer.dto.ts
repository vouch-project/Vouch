import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CreateLendOfferDto {
  @IsBigInt()
  offerId!: bigint;

  @IsString()
  lenderAddress!: string;

  @IsString()
  principalTokenAddress!: string;

  @IsBigInt()
  principalAmount!: bigint;

  @IsNumber()
  collateralRatioBps!: number;

  @IsNumber()
  trustedRatioBps!: number;

  @IsNumber()
  scoreThreshold!: number;

  @IsNumber()
  maxLtvBps!: number;

  @IsNumber()
  interestRateBps!: number;

  @IsNumber()
  durationSeconds!: number;

  @IsNumber()
  acceptWindowSeconds!: number;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsDate()
  @Type(() => Date)
  createdAt!: Date;
}
