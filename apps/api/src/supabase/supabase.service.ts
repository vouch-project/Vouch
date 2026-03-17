import { Injectable, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';

@Injectable({ scope: Scope.REQUEST })
export class SupabaseService {
  private clientInstance: SupabaseClient<Database>;

  constructor(private configService: ConfigService) {}

  get client() {
    if (this.clientInstance) {
      return this.clientInstance;
    }

    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SECRET_KEY');

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars');
    }

    this.clientInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    return this.clientInstance;
  }
}
