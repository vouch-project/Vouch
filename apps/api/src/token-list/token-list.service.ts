import { HttpService } from '@nestjs/axios/dist/http.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';

export type Token = {
  chainId: number;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number | null;
  logoURI: string | null;
  priceUSD?: string;
  coinKey?: string;
};

export type TokenListResponse = {
  tokens: {
    [chainId: string]: Token[];
  };
};

@Injectable()
export class TokenListService implements OnModuleInit {
  private readonly logger = new Logger(TokenListService.name);
  private readonly tokenListUrl = 'https://li.quest/v1/tokens?chains=1';
  private tokenCache: Token[] = [];

  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async onModuleInit() {
    await this.fetchTokenList();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  private async fetchTokenList() {
    this.logger.log('Fetching token list from Coingecko...');
    try {
      // const raw = (
      //   await this.httpService.axiosRef.get<TokenListResponse>(
      //     this.tokenListUrl,
      //   )
      // ).data;
      const raw: TokenListResponse = {
        tokens: {
          '1337': [
            {
              chainId: 1337,
              address: '0x0000000000000000000000000000000000000000',
              symbol: 'ETH',
              name: 'ETH',
              decimals: 18,
              logoURI:
                'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
            },
          ],
        },
      };

      const tokensArr = Object.values(raw.tokens).flat();

      const tokens = tokensArr.map((token) => ({
        chainId: token.chainId,
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoURI: token.logoURI,
      }));

      const { data, error } = await this.supabaseService.client
        .from('token_list')
        .upsert(tokens, { onConflict: 'chainId,address' })
        .select('*');

      if (error) this.logger.error(`Error upserting tokens:`, error);

      this.tokenCache = data || [];
    } catch (err) {
      this.logger.error('Token list update failed:', err);
    }
  }

  get tokenList() {
    return this.tokenCache;
  }
}
