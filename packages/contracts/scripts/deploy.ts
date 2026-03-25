
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ethers, upgrades } from 'hardhat';
import path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  const VouchVault = await ethers.getContractFactory('VouchVault');

  // Check for --upgrade argument
  const isUpgrade = process.argv.includes('--upgrade');

  // .env path and variable
  const envPath = path.resolve(__dirname, '../../../.env');
  const envVarName = 'PUBLIC_VOUCH_VAULT_ADDRESS';
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
