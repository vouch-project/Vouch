import { HttpModule } from '@nestjs/axios/dist/http.module';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokenListController } from './token-list.controller';
import { TokenListService } from './token-list.service';

@Module({
  imports: [HttpModule.register({ timeout: 5000 }), SupabaseModule],
  controllers: [TokenListController],
  providers: [TokenListService],
})
export class TokenListModule {}
