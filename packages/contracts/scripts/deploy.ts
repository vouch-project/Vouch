import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ethers, network, upgrades } from 'hardhat';
import path from 'path';
import type { VouchVault, VouchVaultLens } from '../typechain-types';

/**
 * Read a variable from the loaded .env file content, falling back to the
 * process environment (for CI / real deploys that inject real env vars).
 */
function readEnvVar(envContent: string, name: string): string | undefined {
  const match = envContent.match(new RegExp(`^${name}=(.*)$`, 'm'));
  const raw = match ? match[1].trim() : process.env[name]?.trim();
  const value = raw?.replace(/^["']|["']$/g, '');
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
async function applyScoreSigner(vault: VouchVault, envContent: string): Promise<void> {
  const signer = readEnvVar(envContent, 'SCORE_SIGNER_PRIVATE_KEY');
  if (!signer) return;
  const address = new ethers.Wallet(signer).address;
  const current = await vault.scoreSigner();
  if (current.toLowerCase() !== address.toLowerCase()) {
    console.log(`Setting scoreSigner -> ${address}`);
    await (await vault.setScoreSigner(address)).wait();
  } else {
    console.log(`scoreSigner already ${address}, skipping`);
  }
}

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

function setEnvVar(env: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  if (new RegExp(`^${name}=`, 'm').test(env)) {
    return env.replace(new RegExp(`^${name}=.*`, 'm'), line);
  }
  return env.trimEnd() + `\n${line}\n`;
}

async function deployLens(
  vaultAddress: string,
  env: string,
  envPath: string,
  lensEnvVarName: string,
  skipIfExists = false,
): Promise<void> {
  if (skipIfExists) {
    const existingLens = readEnvVar(env, lensEnvVarName);
    if (existingLens) {
      console.log(`VouchVaultLens already deployed at ${existingLens}, skipping`);
      return;
    }
  }
  console.log('Deploying VouchVaultLens...');
  const LensFactory = await ethers.getContractFactory('VouchVaultLens');
  const lens = (await LensFactory.deploy(vaultAddress)) as unknown as VouchVaultLens;
  await lens.waitForDeployment();
  const lensAddress = await lens.getAddress();
  console.log(`VouchVaultLens deployed to: ${lensAddress}`);
  const updated = setEnvVar(readFileSync(envPath, 'utf-8'), lensEnvVarName, lensAddress);
  writeFileSync(envPath, updated, 'utf-8');
  console.log(`✅ Saved ${lensEnvVarName} to ${envPath}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  const VouchVault = await ethers.getContractFactory('VouchVault');

  // Check for upgrade mode via env var (Hardhat rejects unknown CLI flags)
  // Usage: UPGRADE=1 npx hardhat run scripts/deploy.ts --network sepolia
  const isUpgrade = process.env.UPGRADE === '1';

  // .env path and variables — Sepolia deployments write to separate keys so
  // PUBLIC_VOUCH_VAULT_ADDRESS always holds the mainnet/local address.
  const envPath = path.resolve(__dirname, '../../../.env');
  const isSepolia = network.name === 'sepolia';
  const envVarName = isSepolia ? 'SEPOLIA_VOUCH_VAULT_ADDRESS' : 'PUBLIC_VOUCH_VAULT_ADDRESS';
  const lensEnvVarName = isSepolia ? 'SEPOLIA_VOUCH_VAULT_LENS_ADDRESS' : 'PUBLIC_VOUCH_VAULT_LENS_ADDRESS';
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
    const upgradedVault = (await ethers.getContractAt('VouchVault', address)) as unknown as VouchVault;
    await applyProtocolConfig(upgradedVault, env);
    await applyScoreSigner(upgradedVault, env);
    // Deploy lens if it hasn't been deployed yet (vault address unchanged after upgrade).
    await deployLens(address, env, envPath, lensEnvVarName, true);
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

  // Apply protocol config (treasury + fee) and score signer from environment variables.
  const deployedVault = (await ethers.getContractAt('VouchVault', address)) as unknown as VouchVault;
  await applyProtocolConfig(deployedVault, env);
  await applyScoreSigner(deployedVault, env);

  // Inject contract address into root .env
  if (!existsSync(envPath)) {
    env = `${envVarName}=${address}\n`;
  } else {
    env = setEnvVar(env, envVarName, address);
  }
  writeFileSync(envPath, env, 'utf-8');
  console.log(`✅ Saved ${envVarName} to ${envPath}`);

  await deployLens(address, env, envPath, lensEnvVarName);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
