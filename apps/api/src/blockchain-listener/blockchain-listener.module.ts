import { Module } from '@nestjs/common';
import { LoanModule } from '../loan/loan.module';
import { BlockchainListenerService } from './blockchain-listener.service';

@Module({
  imports: [LoanModule],
  providers: [BlockchainListenerService],
})
export class BlockchainListenerModule {}
