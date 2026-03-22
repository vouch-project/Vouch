import { Module } from '@nestjs/common';
import { LoanModule } from '../loan/loan.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { BlockchainListenerService } from './blockchain-listener.service';

@Module({
  imports: [SupabaseModule, LoanModule],
  providers: [BlockchainListenerService],
})
export class BlockchainListenerModule {}
