import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';

export class CreateLoanDto {
  @IsNumber()
  loanId: bigint;

  @IsString()
  borrower: string;

  @IsNumber()
  collateralAmount: bigint;

  @IsNumberString()
  networkId: string;

  @IsString()
  collateralTxHash: string;

  @IsNumber()
  collateralBlockNumber: number;

  @IsString()
  collateralBlockHash: string;

  @IsDate()
  collateralLockedAt: Date;

  @IsString()
  collateralTokenAddress: string;

  @IsNumber()
  logIndex: number;

  @IsString()
  contractAddress: string;
}
