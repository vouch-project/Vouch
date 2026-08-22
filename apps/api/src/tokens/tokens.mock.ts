import type { TokenListResponse } from './tokens.service';

const SEPOLIA_CHAIN_ID = 11155111;

/**
 * A mock token deployed to Sepolia by
 * `packages/contracts/scripts/deploy-sepolia-mock-tokens.ts`, as serialised into
 * the SEPOLIA_MOCK_TOKENS env var.
 */
type SepoliaMockToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  feedAddress: string;
};

/**
 * Sepolia mocks live in an env var rather than the database because
 * TokensService builds its Redis cache from the tokens it just upserted. Without
 * this injection they would sit in Postgres but vanish from the API's token list
 * on the next sync.
 */
export const sepoliaTokensMock = (
  serialised: string,
): TokenListResponse['tokens'][string] => {
  const parsed: unknown = JSON.parse(serialised);
  if (!Array.isArray(parsed)) {
    throw new Error('SEPOLIA_MOCK_TOKENS must be a JSON array');
  }

  return (parsed as unknown[]).map((item, i) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as SepoliaMockToken).address !== 'string' ||
      typeof (item as SepoliaMockToken).symbol !== 'string' ||
      typeof (item as SepoliaMockToken).name !== 'string' ||
      typeof (item as SepoliaMockToken).decimals !== 'number' ||
      typeof (item as SepoliaMockToken).feedAddress !== 'string'
    ) {
      throw new Error(
        `SEPOLIA_MOCK_TOKENS[${i}] is missing required fields or has wrong types (expected address, symbol, name, feedAddress as strings and decimals as number)`,
      );
    }
    const token = item as SepoliaMockToken;
    return {
      chainId: SEPOLIA_CHAIN_ID,
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      logoURI: null,
      priceUsd: null,
      volatility: null,
      priceFeedAddress: token.feedAddress,
    };
  });
};

const ZERO = '0x0000000000000000000000000000000000000000';

export const tokensMock = (
  HARDCODED_MOCK_ERC20_ADDRESS: string,
  ethFeedAddress = ZERO,
  mockFeedAddress = ZERO,
): TokenListResponse['tokens'] => ({
  '1337': [
    {
      chainId: 1337,
      address: ZERO,
      symbol: 'ETH',
      name: 'ETH',
      decimals: 18,
      logoURI:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
      priceUsd: null,
      volatility: null,
      priceFeedAddress: ethFeedAddress,
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
      priceFeedAddress: mockFeedAddress,
    },
  ],
});
