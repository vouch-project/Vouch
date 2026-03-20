import { Module } from '@nestjs/common';
import { BlockchainListenerService } from './blockchain-listener.service';

@Module({
  providers: [BlockchainListenerService],
})
export class BlockchainListenerModule {}
