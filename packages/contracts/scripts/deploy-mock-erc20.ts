import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ethers } from 'hardhat';
import path from 'path';

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  // Deploy MockERC20 from a DEDICATED account (the last signer) whose only job is
  // this single deployment. Because that account sends no other transactions, its
  // nonce is always 0 on a fresh node, so the token's CREATE address
  // (keccak(deployer, nonce)) is deterministic and does NOT shift when the number
  // of transactions from the main deployer changes (e.g. protocol-fee config).
  // This keeps the address stable across redeploys so MetaMask / token imports
  // don't need to be reconfigured every time.
  const tokenDeployer = signers[signers.length - 1];
  console.log(`Deploying MockERC20 with dedicated account: ${tokenDeployer.address}`);

  const MockERC20 = await ethers.getContractFactory('MockERC20', tokenDeployer);
  // Example: 1,000,000 tokens, 18 decimals
  const initialSupply = ethers.parseUnits('1000000', 18);
  const token = await MockERC20.deploy('MockToken', 'MOCK', 18, initialSupply);
  await token.waitForDeployment();
  const HARDCODED_MOCK_ERC20_ADDRESS = await token.getAddress();
  console.log(`MockERC20 deployed to: ${HARDCODED_MOCK_ERC20_ADDRESS}`);

  // Preserve previous behaviour: the primary deployer account (#0) used to receive
  // the initial supply when it was the token deployer. The constructor minted the
  // full supply to the dedicated token deployer, so transfer it to the primary
  // account instead of minting again — this keeps total supply at initialSupply.
  await (await token.transfer(deployer.address, initialSupply)).wait();
  console.log(`Transferred initial supply to primary account: ${deployer.address}`);

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
