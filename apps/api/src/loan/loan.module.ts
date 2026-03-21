import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { LoanService } from './loan.service';

@Module({
  imports: [SupabaseModule],
  providers: [LoanService],
  exports: [LoanService],
})
export class LoanModule {}
