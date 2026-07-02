import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class PartialRepayLoanDto {
  @IsBigInt()
  onChainLoanId!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  borrowerAddress!: string;

  /** Raw token units paid in this single payment. */
  @IsBigInt()
  paymentAmount!: bigint;

  /** Cumulative raw principal repaid so far (on-chain loan.principalRepaid). */
  @IsBigInt()
  principalRepaid!: bigint;

  /** Cumulative raw collateral released so far (on-chain loan.collateralReleased). */
  @IsBigInt()
  collateralReleased!: bigint;

  @IsString()
  txHash!: string;

  @IsNumber()
  blockNumber!: number;

  @IsString()
  blockHash!: string;

  @IsNumber()
  logIndex!: number;

  @IsDate()
  @Type(() => Date)
  paidAt!: Date;
}
