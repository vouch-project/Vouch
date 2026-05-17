import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [HttpModule, SupabaseModule],
  controllers: [ScoringController],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
