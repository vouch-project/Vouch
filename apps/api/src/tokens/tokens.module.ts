import { RedisModule } from '@nestjs-modules/ioredis';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 5000 }),
    SupabaseModule,
    RedisModule,
  ],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
