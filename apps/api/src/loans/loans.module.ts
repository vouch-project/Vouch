import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { LoansService } from './loans.service';
import { SignedOrdersController } from './signed-orders.controller';
import { SignedOrdersService } from './signed-orders.service';

@Module({
  imports: [SupabaseModule],
  controllers: [SignedOrdersController],
  providers: [LoansService, SignedOrdersService],
  exports: [LoansService, SignedOrdersService],
})
export class LoansModule {}
