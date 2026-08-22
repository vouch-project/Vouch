import { IsNumberString, IsString } from 'class-validator';

export class CancelSignedOrderDto {
  @IsString()
  digest!: string;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;
}
