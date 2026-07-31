import { existsSync, readFileSync } from 'fs';
import { ethers } from 'hardhat';
import path from 'path';
import { Client } from 'pg';

const SEPOLIA_NETWORK_ID = '11155111';

// Chainlink Sepolia price feed addresses (8 decimals each).
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1#sepolia-testnet
const CHAINLINK_FEEDS: {
  symbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  feedAddress: string;
}[] = [
  {
    symbol: 'ETH',
    tokenAddress: ethers.ZeroAddress,
    tokenDecimals: 18,
    feedAddress: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
  },
  {
    symbol: 'USDC',
    tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenDecimals: 6,
    feedAddress: '0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E',
  },
  {
    symbol: 'EURC',
    tokenAddress: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
    tokenDecimals: 6,
    feedAddress: '0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910',
  },
];

const VOUCH_VAULT_ABI = ['function setPriceFeed(address token, address feed, uint8 decimals_) external'];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Setting up Sepolia price feeds with account: ${deployer.address}`);

  const envPath = path.resolve(__dirname, '../../../.env');
  if (!existsSync(envPath)) throw new Error('.env not found');
  const env = readFileSync(envPath, 'utf-8');

  const vaultMatch = env.match(/^SEPOLIA_VOUCH_VAULT_ADDRESS=(.*)$/m);
  if (!vaultMatch?.[1]?.trim()) throw new Error('SEPOLIA_VOUCH_VAULT_ADDRESS not set in .env');
  const vaultAddress = vaultMatch[1].trim();

  const databaseUrlMatch = env.match(/^DATABASE_URL=(.*)$/m);
  if (!databaseUrlMatch) throw new Error('DATABASE_URL not set in .env');
  const db = new Client({ connectionString: databaseUrlMatch[1].trim() });
  await db.connect();

  try {
    const vault = new ethers.Contract(vaultAddress, VOUCH_VAULT_ABI, deployer);

    for (const { symbol, tokenAddress, tokenDecimals, feedAddress } of CHAINLINK_FEEDS) {
      // Register the feed on-chain.
      await (await vault.setPriceFeed(tokenAddress, feedAddress, tokenDecimals)).wait();
      console.log(`${symbol} price feed registered on-chain (feed: ${feedAddress})`);

      // Mirror the feed address into Postgres so PriceFeedService polls it.
      const checksummedToken = ethers.getAddress(tokenAddress);
      const result = await db.query(
        `UPDATE tokens
         SET price_feed_address = $1
         WHERE "chainId" = (SELECT id FROM chains WHERE "networkId" = $2)
           AND address = $3`,
        [feedAddress, SEPOLIA_NETWORK_ID, checksummedToken],
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`${symbol} price feed address mirrored to Postgres`);
      } else {
        console.warn(
          `Warning: no tokens row found for ${symbol} (${checksummedToken}) on Sepolia — ` +
            'has the API run at least once to sync the token list?',
        );
      }
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
