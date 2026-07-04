// Refreshes mock Chainlink price feed timestamps on the local Hardhat network.
// VouchVault rejects prices older than 1 hour (STALE_PRICE_THRESHOLD), so run
// this whenever getHealthFactor starts reverting with "Stale price" locally:
//
//   npx hardhat run scripts/refresh-mock-prices.ts --network localhost
//
// On real networks (Sepolia, mainnet) this is unnecessary — Chainlink nodes
// update feeds automatically within their heartbeat interval.

import { ethers } from 'hardhat';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { Client } from 'pg';

const MOCK_AGGREGATOR_ABI = [
  'function updateAnswer(int256 _answer) external',
  'function latestAnswer() external view returns (int256)',
  'function decimals() external view returns (uint8)',
];

// Reads all price_feed_address entries for the local Hardhat chain from Postgres
// and calls updateAnswer on each mock aggregator. This bumps updatedAt to
// block.timestamp, resetting the 1-hour staleness window enforced by VouchVault.
async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await signer.provider.getNetwork();
  if (chainId !== 1337n) {
    throw new Error(`refresh-mock-prices must be run against local chainId 1337, got ${chainId}`);
  }

  const envPath = path.resolve(__dirname, '../../../.env');
  if (!existsSync(envPath)) throw new Error('.env not found');
  const env = readFileSync(envPath, 'utf-8');

  const databaseUrlMatch = env.match(/^DATABASE_URL=(.*)$/m);
  if (!databaseUrlMatch) throw new Error('DATABASE_URL not set in .env');

  const db = new Client({ connectionString: databaseUrlMatch[1].trim() });
  await db.connect();

  try {
    const LOCAL_NETWORK_ID = '1337';
    const result = await db.query<{ price_feed_address: string; symbol: string }>(
      `SELECT t.price_feed_address, t.symbol
       FROM tokens t
       JOIN chains c ON t."chainId" = c.id
       WHERE c."networkId" = $1
         AND t.price_feed_address IS NOT NULL`,
      [LOCAL_NETWORK_ID],
    );

    if (result.rows.length === 0) {
      console.log('No price feeds found for local network — run deploy-mock-aggregators.ts first.');
      return;
    }

    for (const { price_feed_address, symbol } of result.rows) {
      const feed = new ethers.Contract(price_feed_address, MOCK_AGGREGATOR_ABI, signer);
      const currentAnswer = (await feed.latestAnswer()) as bigint;
      const tx = await feed.updateAnswer(currentAnswer);
      await tx.wait();
      console.log(`Refreshed ${symbol} feed at ${price_feed_address} (answer unchanged: ${currentAnswer})`);
    }

    console.log('All mock price feeds refreshed.');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
