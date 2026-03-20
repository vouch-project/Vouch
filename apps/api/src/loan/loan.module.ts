import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { LoanController } from './loan.controller';
import { LoanService } from './loan.service';

@Module({
  imports: [SupabaseModule],
  controllers: [LoanController],
  providers: [LoanService],
})
export class LoanModule {}
