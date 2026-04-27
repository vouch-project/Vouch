import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CreateLoanDto {
  @IsBigInt()
  loanId!: bigint;

  @IsString()
  borrower!: string;

  @IsBigInt()
  collateralAmount!: bigint;

  @IsString()
  requestedPrincipalTokenAddress!: string;

  @IsBigInt()
  requestedPrincipalAmount!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  collateralTxHash!: string;

  @IsNumber()
  collateralBlockNumber!: number;

  @IsString()
  collateralBlockHash!: string;

  @IsDate()
  @Type(() => Date)
  collateralLockedAt!: Date;

  @IsString()
  collateralTokenAddress!: string;

  @IsNumber()
  logIndex!: number;

  @IsString()
  contractAddress!: string;
}
