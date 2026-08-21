import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PriceFeedService } from './price-feed.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [SupabaseModule, RedisModule],
  providers: [TokensService, PriceFeedService],
  exports: [TokensService, PriceFeedService],
})
export class TokensModule {}
