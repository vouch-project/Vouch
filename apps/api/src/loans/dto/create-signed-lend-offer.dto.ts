import { IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CreateSignedLendOfferDto {
  @IsString()
  lenderAddress!: string;

  @IsString()
  principalTokenAddress!: string;

  @IsBigInt()
  principalAmount!: bigint;

  @IsString()
  collateralTokenAddress!: string;

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

  @IsBigInt()
  nonce!: bigint;

  @IsNumber()
  deadline!: number;

  @IsString()
  signature!: string;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;
}
