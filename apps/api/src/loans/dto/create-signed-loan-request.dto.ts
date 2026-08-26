import { IsNumber, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateSignedLoanRequestDto {
  @IsString()
  borrowerAddress!: string;

  @IsString()
  collateralTokenAddress!: string;

  @IsNumberString()
  collateralAmount!: string;

  @IsString()
  principalTokenAddress!: string;

  @IsNumberString()
  principalAmount!: string;

  @IsNumber()
  interestRateBps!: number;

  @IsNumber()
  durationSeconds!: number;

  @IsNumber()
  maxLtvBps!: number;

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

  @IsOptional()
  @IsNumber()
  ltvAttestationMaxLtvBps?: number;

  @IsOptional()
  @IsNumber()
  ltvAttestationExpiry?: number;

  @IsOptional()
  @IsString()
  ltvAttestationSig?: string;
}
