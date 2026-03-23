import { IsNumber, IsNumberString, IsString } from 'class-validator';

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

  @IsString()
  collateralLockedAt: string;

  @IsString()
  collateralTokenAddress: string;

  @IsNumber()
  logIndex: number;

  @IsString()
  contractAddress: string;
}
