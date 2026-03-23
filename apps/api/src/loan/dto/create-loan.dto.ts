import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';

export class CreateLoanDto {
  @IsNumberString()
  loanId: string;

  @IsString()
  borrower: string;

  @IsNumberString()
  collateralAmount: string;

  @IsNumberString()
  networkId: string;

  @IsString()
  collateralTxHash: string;

  @IsNumberString()
  collateralBlockNumber: string;

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
