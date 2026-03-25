import { RedisModule } from '@nestjs-modules/ioredis';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokenListController } from './tokens.controller';
import { TokenListService } from './tokens.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 5000 }),
    SupabaseModule,
    RedisModule,
  ],
  controllers: [TokenListController],
  providers: [TokenListService],
  exports: [TokenListService],
})
export class TokenListModule {}
