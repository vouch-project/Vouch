import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { LoansService } from './loans.service';
import { SignedOrdersController } from './signed-orders.controller';
import { SignedOrdersService } from './signed-orders.service';

@Module({
  imports: [RedisModule, SupabaseModule],
  controllers: [SignedOrdersController],
  providers: [LoansService, SignedOrdersService],
  exports: [LoansService, SignedOrdersService],
})
export class LoansModule {}
