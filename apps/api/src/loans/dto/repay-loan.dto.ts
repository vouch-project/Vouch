import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class RepayLoanDto {
  @IsBigInt()
  onChainLoanId!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  borrowerAddress!: string;

  @IsString()
  lenderAddress!: string;

  @IsBigInt()
  principalAmount!: bigint;

  @IsBigInt()
  interestAmount!: bigint;

  @IsBigInt()
  totalRepaid!: bigint;

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
  repaidAt!: Date;
}
