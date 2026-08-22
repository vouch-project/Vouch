import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokensModule } from '../tokens/tokens.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [RedisModule, SupabaseModule, TokensModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
