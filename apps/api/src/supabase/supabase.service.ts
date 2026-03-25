import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';

@Injectable()
export class SupabaseService implements OnModuleInit {
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
  }

  async onModuleInit() {
    await this.isDatabaseActive();
  }

  get client() {
    return this.clientInstance;
  }

  private async isDatabaseActive(retries = 3) {
    this.logger.log('Checking Supabase DB connectivity...');

    for (let i = 0; i < retries; i++) {
      const { error } = await this.client.from('loans').select('*').limit(1);

      if (!error) {
        this.logger.log('Supabase DB is active and reachable');
        return;
      }

      this.logger.warn(
        `Supabase DB health check attempt ${i + 1} failed: ${error.message}`,
      );
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    this.logger.error('Supabase DB health check failed after all retries');
  }
}
