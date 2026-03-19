import { IsNumber, IsString } from 'class-validator';

export class CreateLoanDto {
  @IsNumber()
  collateralAmount: number;

  @IsNumber()
  chainId: number;

  @IsString()
  collateralTxHash: string;

  @IsNumber()
  collateralBlockNumber: number;

  @IsString()
  collateralBlockHash: string;

  @IsString()
  collateralLockedAt: string;

  @IsString()
  collateralTokenId: string;
}
