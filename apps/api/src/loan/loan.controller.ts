import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoanService } from './loan.service';

type AuthenticatedRequest = Request & {
  user?: { address?: string };
};

@Controller('loan')
export class LoanController {
  constructor(private readonly loanService: LoanService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  createLoan(
    @Body() createLoanDto: CreateLoanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const borrower = req.user?.address;
    if (!borrower) throw new Error('No borrower address found in JWT');

    return this.loanService.create(createLoanDto, borrower);
  }
}
