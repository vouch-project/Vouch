import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CreateLoanDto } from './dto/create-loan.dto';
import { VerifySignatureGuard } from './guards/verify-signature.guard';
import { LoanService } from './loan.service';

@Controller('loan')
export class LoanController {
  constructor(private readonly loanService: LoanService) {}

  @Post()
  @UseGuards(VerifySignatureGuard)
  createLoan(@Body() body: CreateLoanDto) {
    console.log(body);
    throw new Error('Not implemented');

    return this.loanService.create();
  }
}
