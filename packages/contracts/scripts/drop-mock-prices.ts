// Slashes all mock Chainlink price feeds by 90% to drive health factors below 1,
// triggering keeper liquidations. For local testing only.
//
//   npx hardhat run scripts/drop-mock-prices.ts --network localhost

import { existsSync, readFileSync } from 'fs';
import { ethers } from 'hardhat';
import path from 'path';
import { Client } from 'pg';

const MOCK_AGGREGATOR_ABI = [
  'function updateAnswer(int256 _answer) external',
  'function latestAnswer() external view returns (int256)',
  'function decimals() external view returns (uint8)',
];

const DROP_FACTOR = 10n; // divide price by 10 → 90% drop

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await signer.provider.getNetwork();
  if (chainId !== 1337n) {
    throw new Error(`drop-mock-prices must be run against local chainId 1337, got ${chainId}`);
  }

  const envPath = path.resolve(__dirname, '../../../.env');
  if (!existsSync(envPath)) throw new Error('.env not found');
  const env = readFileSync(envPath, 'utf-8');

  const databaseUrlMatch = env.match(/^DATABASE_URL=(.*)$/m);
  if (!databaseUrlMatch) throw new Error('DATABASE_URL not set in .env');

  const db = new Client({ connectionString: databaseUrlMatch[1].trim() });
  await db.connect();

  try {
    const result = await db.query<{ price_feed_address: string; symbol: string }>(
      `SELECT t.price_feed_address, t.symbol
       FROM tokens t
       JOIN chains c ON t."chainId" = c.id
       WHERE c."networkId" = $1
         AND t.price_feed_address IS NOT NULL
         AND t.address != $2`,
      ['1337', ethers.ZeroAddress],
    );

    if (result.rows.length === 0) {
      console.log('No price feeds found — run deploy-mock-aggregators.ts first.');
      return;
    }

    for (const { price_feed_address, symbol } of result.rows) {
      const feed = new ethers.Contract(price_feed_address, MOCK_AGGREGATOR_ABI, signer);
      const current = (await feed.latestAnswer()) as bigint;
      const dropped = current / DROP_FACTOR;
      const tx = await feed.updateAnswer(dropped);
      await tx.wait();
      console.log(`Dropped ${symbol}: ${current} → ${dropped} (÷${DROP_FACTOR})`);
    }

    console.log('Done. Active loans should now be undercollateralized on the next keeper cycle.');
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
