import { Type } from 'class-transformer';
import { IsObject, IsString } from 'class-validator';

export class CreateLoanDto {
  @IsString()
  address: string;

  @IsString()
  signature: string;

  @IsString()
  message: string;

  @IsObject()
  @Type(() => Object)
  loanData: Record<string, unknown>;
}
