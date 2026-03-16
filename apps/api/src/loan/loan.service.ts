import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';

@Injectable()
export class LoanService {
  constructor(private readonly supabaseService: SupabaseService) {}

  create() {
    return [];
  }
}
