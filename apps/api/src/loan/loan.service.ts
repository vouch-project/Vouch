import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateLoanDto } from './dto/create-loan.dto';

@Injectable()
export class LoanService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create({
    collateralTokenAddress,
    networkId,
    ...createLoanDto
  }: CreateLoanDto) {
    const { data: chain, error: chainError } = await this.supabaseService.client
      .from('chains')
      .select('id')
      .eq('networkId', networkId)
      .single();

    if (chainError || !chain) throw new Error(`Chain not found: ${networkId}`);

    const collateralTokenAddressLower = collateralTokenAddress.toLowerCase();

    const { data: token, error: tokenError } = await this.supabaseService.client
      .from('token_list')
      .select('id')
      .eq('address', collateralTokenAddressLower)
      .eq('chainId', chain.id)
      .single();

    if (tokenError || !token)
      throw new Error(
        `Collateral token not found in token_list: ${collateralTokenAddress} on chain ${networkId}`,
      );

    const { error } = await this.supabaseService.client.from('loans').insert({
      ...createLoanDto,
      collateralTokenId: token.id,
      chainId: chain.id,
    });

    if (error) throw error;
  }
}
