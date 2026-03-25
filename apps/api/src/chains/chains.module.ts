import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokensModule } from '../tokens/tokens.module';
import { ChainsController } from './chains.controller';
import { ChainsService } from './chains.service';

@Module({
  imports: [SupabaseModule, TokensModule],
  controllers: [ChainsController],
  providers: [ChainsService],
})
export class ChainsModule {}
