import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateLoanDto } from './dto/create-loan.dto';

@Injectable()
export class LoanService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create({ collateralTokenAddress, ...createLoanDto }: CreateLoanDto) {
    const { data: token, error: tokenError } = await this.supabaseService.client
      .from('token_list')
      .select('id::text')
      .eq('address', collateralTokenAddress)
      .eq('chainId', createLoanDto.chainId)
      .single();

    if (tokenError || !token)
      throw new Error(
        `Collateral token not found in token_list: ${collateralTokenAddress} on chain ${createLoanDto.chainId}`,
      );

    const { error } = await this.supabaseService.client
      .from('loans')
      .insert({ ...createLoanDto, collateralTokenId: token.id });

    if (error) throw error;
  }
}
