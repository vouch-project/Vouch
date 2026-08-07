import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ethers, network, upgrades } from 'hardhat';
import path from 'path';
import type { VouchVault } from '../typechain-types';

/**
 * Read a variable from the loaded .env file content, falling back to the
 * process environment (for CI / real deploys that inject real env vars).
 */
function readEnvVar(envContent: string, name: string): string | undefined {
  const match = envContent.match(new RegExp(`^${name}=(.*)$`, 'm'));
  const value = match ? match[1].trim() : process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Apply protocol configuration (treasury + fee) from environment variables.
 * Only sends a transaction when the desired value differs from the current
 * on-chain value, so re-running is idempotent and cheap.
 *
 *   PROTOCOL_TREASURY_ADDRESS - wallet that receives protocol fees
 *   PROTOCOL_FEE_BPS          - fee in basis points (1000 = 10%, max 5000)
 */
async function applyProtocolConfig(vault: VouchVault, envContent: string): Promise<void> {
  const treasury = readEnvVar(envContent, 'PROTOCOL_TREASURY_ADDRESS');
  if (treasury) {
    if (!ethers.isAddress(treasury)) {
      throw new Error(`PROTOCOL_TREASURY_ADDRESS is not a valid address: ${treasury}`);
    }
    const current = (await vault.protocolTreasury()) as string;
    if (current.toLowerCase() !== treasury.toLowerCase()) {
      console.log(`Setting protocol treasury -> ${treasury}`);
      await (await vault.setProtocolTreasury(treasury)).wait();
    } else {
      console.log(`Protocol treasury already ${treasury}, skipping`);
    }
  }

  const feeBpsRaw = readEnvVar(envContent, 'PROTOCOL_FEE_BPS');
  if (feeBpsRaw) {
    const feeBps = Number(feeBpsRaw);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5000) {
      throw new Error(`PROTOCOL_FEE_BPS must be an integer between 0 and 5000, got: ${feeBpsRaw}`);
    }
    const current = Number(await vault.protocolFeeBps());
    if (current !== feeBps) {
      console.log(`Setting protocol fee -> ${feeBps} bps`);
      await (await vault.setProtocolFeeBps(feeBps)).wait();
    } else {
      console.log(`Protocol fee already ${feeBps} bps, skipping`);
    }
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  const VouchVault = await ethers.getContractFactory('VouchVault');

  // Check for --upgrade argument
  const isUpgrade = process.argv.includes('--upgrade');

  // .env path and variable — Sepolia deployments write to a separate key so
  // PUBLIC_VOUCH_VAULT_ADDRESS always holds the mainnet/local address.
  const envPath = path.resolve(__dirname, '../../../.env');
  const envVarName =
    network.name === 'sepolia' ? 'SEPOLIA_VOUCH_VAULT_ADDRESS' : 'PUBLIC_VOUCH_VAULT_ADDRESS';
  let env = '';
  let proxyAddress = '';

  if (existsSync(envPath)) {
    env = readFileSync(envPath, 'utf-8');
    const match = env.match(new RegExp(`^${envVarName}=(.*)$`, 'm'));
    if (match) {
      proxyAddress = match[1].trim();
    }
  }

  if (isUpgrade) {
    if (!proxyAddress) {
      throw new Error('No proxy address found in .env for upgrade.');
    }
    console.log(`Upgrading VouchVault at proxy: ${proxyAddress}`);
    const upgraded = await upgrades.upgradeProxy(proxyAddress, VouchVault);
    await upgraded.waitForDeployment();
    const address = await upgraded.getAddress();
    console.log(`VouchVault (Proxy) upgraded at: ${address}`);
    // Re-apply protocol config in case env values changed.
    await applyProtocolConfig((await ethers.getContractAt('VouchVault', address)) as unknown as VouchVault, env);
    // No need to update .env, address stays the same
    return;
  }

  // Deploy new proxy
  console.log('Deploying VouchVault Proxy...');
  const vault = await upgrades.deployProxy(VouchVault, [deployer.address], {
    kind: 'uups',
  });
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  console.log(`VouchVault (Proxy) deployed to: ${address}`);

  // Apply protocol config (treasury + fee) from environment variables.
  await applyProtocolConfig((await ethers.getContractAt('VouchVault', address)) as unknown as VouchVault, env);

  // Inject contract address into root .env
  const envLine = `${envVarName}=${address}`;
  if (!existsSync(envPath)) {
    env = envLine;
  } else {
    // Check if the variable already exists
    if (new RegExp(`^${envVarName}=`, 'm').test(env)) {
      // Replace existing line
      env = env.replace(new RegExp(`^${envVarName}=.*`, 'm'), envLine);
    } else {
      // Append to the end, ensuring there is a newline first
      env = env.trimEnd() + `\n${envLine}\n`;
    }
  }

  writeFileSync(envPath, env, 'utf-8');
  console.log(`✅ Saved ${envVarName} to ${envPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
