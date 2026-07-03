import { TokenListResponse } from './tokens.service';

export const tokensMock = (
  HARDCODED_MOCK_ERC20_ADDRESS: string,
): TokenListResponse['tokens'] => ({
  '1337': [
    {
      chainId: 1337,
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'ETH',
      decimals: 18,
      logoURI:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
      priceUsd: null,
      volatility: null,
    },
    {
      chainId: 1337,
      address: HARDCODED_MOCK_ERC20_ADDRESS,
      symbol: 'MOCK',
      name: 'MockToken',
      decimals: 18,
      logoURI: null,
      priceUsd: null,
      volatility: null,
    },
  ],
});
