import { ethers } from 'hardhat';

async function main() {
  const HARDCODED_MOCK_ERC20_ADDRESS = process.env.HARDCODED_MOCK_ERC20_ADDRESS;

  if (!HARDCODED_MOCK_ERC20_ADDRESS) throw new Error('HARDCODED_MOCK_ERC20_ADDRESS not set in .env or as argument');

  const [deployer, ...accounts] = await ethers.getSigners();
  const MockERC20 = await ethers.getContractAt('MockERC20', HARDCODED_MOCK_ERC20_ADDRESS);

  const amount = ethers.parseUnits('100', 18);

  for (const account of accounts) {
    const tx = await MockERC20.mint(account.address, amount);
    await tx.wait();
    console.log(`Minted 100 MOCK to ${account.address}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
