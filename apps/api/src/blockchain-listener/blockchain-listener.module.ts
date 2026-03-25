import { Module } from '@nestjs/common';
import { LoansModule } from '../loans/loans.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { BlockchainListenerService } from './blockchain-listener.service';

@Module({
  imports: [SupabaseModule, LoansModule],
  providers: [BlockchainListenerService],
})
export class BlockchainListenerModule {}
