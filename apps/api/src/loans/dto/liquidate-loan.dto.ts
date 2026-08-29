import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class LiquidateLoanDto {
  @IsBigInt()
  onChainLoanId!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  liquidatorAddress!: string;

  @IsBigInt()
  amountPaid!: bigint;

  @IsBigInt()
  collateralSeized!: bigint;

  /** Cumulative raw principal repaid (on-chain loan.principalRepaid). */
  @IsBigInt()
  principalRepaid!: bigint;

  /** Cumulative raw collateral released (on-chain loan.collateralReleased). */
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
  liquidatedAt!: Date;
}
