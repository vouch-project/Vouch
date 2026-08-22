import { IsNumber, IsNumberString, IsString } from 'class-validator';

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
}
