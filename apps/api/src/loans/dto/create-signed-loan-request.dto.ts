import { IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CreateSignedLoanRequestDto {
  @IsString()
  borrowerAddress!: string;

  @IsString()
  collateralTokenAddress!: string;

  @IsBigInt()
  collateralAmount!: bigint;

  @IsString()
  principalTokenAddress!: string;

  @IsBigInt()
  principalAmount!: bigint;

  @IsNumber()
  interestRateBps!: number;

  @IsNumber()
  durationSeconds!: number;

  @IsNumber()
  maxLtvBps!: number;

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
