import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@vouch/database-types';

@Injectable()
export class SupabaseService {
  private clientInstance: SupabaseClient<Database>;
  private readonly logger = new Logger(SupabaseService.name);

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SECRET_KEY');

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars');
    }

    this.clientInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    void this.isDatabaseActive();
  }

  get client() {
    return this.clientInstance;
  }

  private async isDatabaseActive() {
    this.logger.log('Checking Supabase DB connectivity...');

    const { error } = await this.client.from('loans').select('*').limit(1);
    if (error) {
      this.logger.error(`Supabase DB health check failed: ${error.message}`);
      return;
    }

    this.logger.log('Supabase DB is active and reachable');
  }
}
