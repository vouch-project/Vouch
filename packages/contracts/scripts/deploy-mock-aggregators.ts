import { ethers } from 'hardhat';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { Client } from 'pg';

// Local Hardhat's networkId, matching supabase/seed.js's chains row for "Local Hardhat".
const LOCAL_NETWORK_ID = '1337';

// The tokens table row for a given (chain, address) is created by the API's
// TokensService on startup (it syncs the Li.Fi token list into Postgres). This
// script can run before that sync completes, so retry the UPDATE briefly instead
// of failing outright — a silent 0-row UPDATE would leave price_feed_address
// unset with no error, which is the exact bug this script exists to avoid.
async function updatePriceFeedAddress(
  db: Client,
  networkId: string,
  tokenAddress: string,
  feedAddress: string,
): Promise<void> {
  const maxAttempts = 10;
  const delayMs = 1000;

  // The tokens table stores EIP-55 checksummed addresses (TokensService writes
  // them via validAddress -> ethers.getAddress). tokenAddress here can come
  // straight from .env (e.g. HARDCODED_MOCK_ERC20_ADDRESS), which isn't
  // guaranteed to already be checksummed — normalize before comparing, or the
  // UPDATE silently matches 0 rows even when the token row exists.
  const checksummedAddress = ethers.getAddress(tokenAddress);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await db.query(
      `UPDATE tokens
       SET price_feed_address = $1
       WHERE "chainId" = (SELECT id FROM chains WHERE "networkId" = $2)
         AND address = $3`,
      [feedAddress, networkId, checksummedAddress],
    );

    if (result.rowCount && result.rowCount > 0) return;

    if (attempt === maxAttempts) {
      console.warn(
        `Warning: no tokens row found for address ${checksummedAddress} on networkId ${networkId} after ${maxAttempts} attempts — ` +
          'price_feed_address was NOT set. Is the API running (TokensService syncs the tokens table on startup)?',
      );
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();

  const envPath = path.resolve(__dirname, '../../../.env');
  if (!existsSync(envPath)) throw new Error('.env not found');
  const env = readFileSync(envPath, 'utf-8');

  const vaultMatch = env.match(/^PUBLIC_VOUCH_VAULT_ADDRESS=(.*)$/m);
  if (!vaultMatch) throw new Error('PUBLIC_VOUCH_VAULT_ADDRESS not set in .env');
  const vaultAddress = vaultMatch[1].trim();

  const mockErc20Match = env.match(/^HARDCODED_MOCK_ERC20_ADDRESS=(.*)$/m);
  const mockErc20Address = mockErc20Match ? mockErc20Match[1].trim() : null;
  if (!mockErc20Address) {
    console.warn('Warning: HARDCODED_MOCK_ERC20_ADDRESS not set in .env — skipping MOCK price feed registration');
  }

  const databaseUrlMatch = env.match(/^DATABASE_URL=(.*)$/m);
  if (!databaseUrlMatch) throw new Error('DATABASE_URL not set in .env');
  const db = new Client({ connectionString: databaseUrlMatch[1].trim() });
  await db.connect();

  try {
    const MockAgg = await ethers.getContractFactory('MockV3Aggregator');

    // ETH/USD: $3200, 8 decimals
    const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
    await ethFeed.waitForDeployment();
    const ethFeedAddress = await ethFeed.getAddress();
    console.log(`ETH/USD MockAggregator deployed to: ${ethFeedAddress}`);

    const VouchVaultAbi = [
      'function setPriceFeed(address token, address feed, uint8 decimals_) external',
    ];
    const vault = new ethers.Contract(vaultAddress, VouchVaultAbi, deployer);

    await vault.setPriceFeed(ethers.ZeroAddress, ethFeedAddress, 18);
    console.log('ETH price feed registered on-chain');

    // Mirror the same feed address into Postgres so PriceFeedService (the API-side
    // poller that powers the frontend's LTV preview) knows to poll it too — the
    // contract's own setPriceFeed above only updates VouchVault's on-chain registry.
    await updatePriceFeedAddress(db, LOCAL_NETWORK_ID, ethers.ZeroAddress, ethFeedAddress);
    console.log('ETH price feed address mirrored to Postgres');

    if (mockErc20Address) {
      // MOCK/USD: $1000, 8 decimals
      const mockFeed = await MockAgg.deploy(8, 1000n * 10n ** 8n);
      await mockFeed.waitForDeployment();
      const mockFeedAddress = await mockFeed.getAddress();
      console.log(`MOCK/USD MockAggregator deployed to: ${mockFeedAddress}`);

      await vault.setPriceFeed(mockErc20Address, mockFeedAddress, 18);
      console.log('MOCK price feed registered on-chain');

      await updatePriceFeedAddress(db, LOCAL_NETWORK_ID, mockErc20Address, mockFeedAddress);
      console.log('MOCK price feed address mirrored to Postgres');
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
