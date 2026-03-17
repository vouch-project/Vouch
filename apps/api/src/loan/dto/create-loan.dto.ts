import { IsNumber } from 'class-validator';

export class CreateLoanDto {
  @IsNumber()
  collateralEth: number;
}
