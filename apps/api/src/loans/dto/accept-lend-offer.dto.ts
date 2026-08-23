import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class AcceptLendOfferDto {
  @IsBigInt()
  offerId!: bigint;

  @IsBigInt()
  loanId!: bigint;

  @IsString()
  borrowerAddress!: string;

  @IsString()
  collateralTokenAddress!: string;

  @IsBigInt()
  collateralAmount!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  txHash!: string;

  @IsNumber()
  blockNumber!: number;

  @IsString()
  blockHash!: string;

  @IsNumber()
  collateralLogIndex!: number;

  @IsNumber()
  disbursementLogIndex!: number;

  @IsDate()
  @Type(() => Date)
  acceptedAt!: Date;
}
