import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CancelLendOfferDto {
  @IsBigInt()
  offerId!: bigint;

  @IsString()
  lenderAddress!: string;

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
  logIndex!: number;

  @IsDate()
  @Type(() => Date)
  cancelledAt!: Date;
}
