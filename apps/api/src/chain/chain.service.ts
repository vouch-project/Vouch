import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TokenListService } from '../token-list/token-list.service';

@Injectable()
export class ChainService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly tokenListService: TokenListService,
  ) {}

  async getChainByNetworkId(networkId: string) {
    const { data, error } = await this.supabaseService.client
      .from('chains')
      .select('contractAddress')
      .eq('networkId', networkId)
      .single();

    if (error || !data)
      throw new NotFoundException(
        `Chain not found for networkId: ${networkId}`,
      );

    const tokens = await this.tokenListService.getTokenList(networkId);

    return { contractAddress: data.contractAddress, tokens };
  }
}
