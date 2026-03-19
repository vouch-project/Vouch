import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { CreateLoanDto } from './dto/create-loan.dto';

@Injectable()
export class LoanService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(createLoanDto: CreateLoanDto, borrower: string) {
    const { data, error } = await this.supabaseService.client
      .from('loans')
      .insert({ borrower, ...createLoanDto })
      .select('*');

    if (error) throw error;

    return data?.[0];
  }
}
