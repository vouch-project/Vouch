import { Type } from 'class-transformer';
import { IsDate, IsIn, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class FillSignedOrderDto {
  @IsIn(['request', 'offer'])
  orderKind!: 'request' | 'offer';

  @IsString()
  digest!: string;

  @IsBigInt()
  loanId!: bigint;

  @IsString()
  fillerAddress!: string;

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

  @IsBigInt()
  blockNumber!: bigint;

  @IsString()
  blockHash!: string;

  @IsBigInt()
  collateralLogIndex!: bigint;

  @IsBigInt()
  disbursementLogIndex!: bigint;

  @IsDate()
  @Type(() => Date)
  filledAt!: Date;
}
