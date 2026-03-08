import { ethers } from 'hardhat';

async function main() {
  const VouchVault = await ethers.getContractFactory('VouchVault');
  const vault = await VouchVault.deploy();
  await vault.waitForDeployment();

  console.log(`VouchVault deployed to: ${await vault.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
