import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class ChainsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly tokensService: TokensService,
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

    const tokens = await this.tokensService.getTokens(networkId);

    return { contractAddress: data.contractAddress, tokens };
  }
}
