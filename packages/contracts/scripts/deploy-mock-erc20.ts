import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ethers } from 'hardhat';
import path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying MockERC20 with the account: ${deployer.address}`);

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  // Example: 1,000,000 tokens, 18 decimals
  const initialSupply = ethers.parseUnits('1000000', 18);
  const token = await MockERC20.deploy('MockToken', 'MOCK', 18, initialSupply);
  await token.waitForDeployment();
  const HARDCODED_MOCK_ERC20_ADDRESS = await token.getAddress();
  console.log(`MockERC20 deployed to: ${HARDCODED_MOCK_ERC20_ADDRESS}`);

  // Write the address to the root .env file
  const envPath = path.resolve(__dirname, '../../../.env');
  const envVarName = 'HARDCODED_MOCK_ERC20_ADDRESS';
  let env = '';
  if (existsSync(envPath)) {
    env = readFileSync(envPath, 'utf-8');
    // Replace or append the variable
    if (new RegExp(`^${envVarName}=`, 'm').test(env)) {
      env = env.replace(new RegExp(`^${envVarName}=.*`, 'm'), `${envVarName}=${HARDCODED_MOCK_ERC20_ADDRESS}`);
    } else {
      // Ensure .env ends with a newline before appending
      if (!env.endsWith('\n')) env += '\n';
      env += `${envVarName}=${HARDCODED_MOCK_ERC20_ADDRESS}\n`;
    }
  } else {
    env = `${envVarName}=${HARDCODED_MOCK_ERC20_ADDRESS}\n`;
  }
  writeFileSync(envPath, env, 'utf-8');
  console.log(`✅ Saved ${envVarName} to ${envPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
