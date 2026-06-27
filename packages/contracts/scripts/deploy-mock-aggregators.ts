import { ethers } from 'hardhat';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

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

  const MockAgg = await ethers.getContractFactory('MockV3Aggregator');

  // ETH/USD: $3200, 8 decimals
  const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
  await ethFeed.waitForDeployment();
  console.log(`ETH/USD MockAggregator deployed to: ${await ethFeed.getAddress()}`);

  const VouchVaultAbi = [
    'function setPriceFeed(address token, address feed) external',
  ];
  const vault = new ethers.Contract(vaultAddress, VouchVaultAbi, deployer);

  await vault.setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress());
  console.log('ETH price feed registered');

  if (mockErc20Address) {
    // MOCK/USD: $1000, 8 decimals
    const mockFeed = await MockAgg.deploy(8, 1000n * 10n ** 8n);
    await mockFeed.waitForDeployment();
    console.log(`MOCK/USD MockAggregator deployed to: ${await mockFeed.getAddress()}`);

    await vault.setPriceFeed(mockErc20Address, await mockFeed.getAddress());
    console.log('MOCK price feed registered');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
