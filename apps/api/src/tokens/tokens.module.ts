import { RedisModule } from '@nestjs-modules/ioredis';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PriceFeedService } from './price-feed.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 5000 }),
    SupabaseModule,
    RedisModule,
  ],
  providers: [TokensService, PriceFeedService],
  exports: [TokensService, PriceFeedService],
})
export class TokensModule {}
