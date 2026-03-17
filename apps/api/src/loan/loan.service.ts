import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { CreateLoanDto } from './dto/create-loan.dto';

@Injectable()
export class LoanService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create({ collateralEth }: CreateLoanDto, borrower: string) {
    return (
      await this.supabaseService.client
        .from('loans')
        .insert({
          borrower,
          collateral_amount: collateralEth,
        })
        .select('*')
    ).data?.[0];
  }
}
