import { RedisModule } from '@nestjs-modules/ioredis';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 5000 }),
    SupabaseModule,
    RedisModule,
  ],
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
