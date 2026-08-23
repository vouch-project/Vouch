import { IsNumber, IsNumberString, IsString } from 'class-validator';

export class CreateSignedLendOfferDto {
  @IsString()
  lenderAddress!: string;

  @IsString()
  principalTokenAddress!: string;

  @IsNumberString()
  principalAmount!: string;

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

  @IsNumberString()
  nonce!: string;

  @IsNumber()
  deadline!: number;

  @IsString()
  signature!: string;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;
}
