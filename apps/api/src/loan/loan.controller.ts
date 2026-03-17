import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { CreateLoanDto } from './dto/create-loan.dto';
import { VerifySignatureGuard } from './guards/verify-signature.guard';
import { LoanService } from './loan.service';

@Controller('loan')
export class LoanController {
  constructor(private readonly loanService: LoanService) {}

  @Post()
  @UseGuards(VerifySignatureGuard)
  createLoan(
    @Body() createLoanDto: CreateLoanDto,
    @Headers('x-address') borrower: string,
  ) {
    return this.loanService.create(createLoanDto, borrower);
  }
}
