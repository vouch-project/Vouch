import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { LoansService } from './loans.service';

@Module({
  imports: [SupabaseModule],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
