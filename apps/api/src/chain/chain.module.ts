import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokenListModule } from '../token-list/token-list.module';
import { ChainController } from './chain.controller';
import { ChainService } from './chain.service';

@Module({
  imports: [SupabaseModule, TokenListModule],
  controllers: [ChainController],
  providers: [ChainService],
})
export class ChainModule {}
