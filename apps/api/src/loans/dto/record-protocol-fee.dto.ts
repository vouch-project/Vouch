import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class RecordProtocolFeeDto {
  @IsBigInt()
  onChainLoanId!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  /** Treasury address that received the fee (read live from the contract). */
  @IsString()
  treasuryAddress!: string;

  /** Raw token units skimmed from the interest portion for this repayment. */
  @IsBigInt()
  feeAmount!: bigint;

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
  collectedAt!: Date;
}
