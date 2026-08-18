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

  @IsString()
  collateralTokenAddress!: string;

  @IsBigInt()
  minCollateralAmount!: bigint;

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

  @IsString()
  txHash!: string;

  @IsNumber()
  blockNumber!: number;

  @IsString()
  blockHash!: string;

  @IsNumber()
  logIndex!: number;

  @IsDate()
  @Type(() => Date)
  createdAt!: Date;
}
