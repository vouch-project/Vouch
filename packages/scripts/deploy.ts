import { ethers } from 'hardhat';

async function main() {
  console.log('Deploying Vouch contracts...');

  // Deploy CreditScoreOracle
  const CreditScoreOracle = await ethers.getContractFactory('CreditScoreOracle');
  const creditScoreOracle = await CreditScoreOracle.deploy();
  await creditScoreOracle.waitForDeployment();
  const oracleAddress = await creditScoreOracle.getAddress();
  console.log(`CreditScoreOracle deployed to: ${oracleAddress}`);

  // Deploy LendingPool
  const LendingPool = await ethers.getContractFactory('LendingPool');
  const lendingPool = await LendingPool.deploy();
  await lendingPool.waitForDeployment();
  const poolAddress = await lendingPool.getAddress();
  console.log(`LendingPool deployed to: ${poolAddress}`);

  console.log('\nDeployment complete!');
  console.log('\nAdd these addresses to your .env file:');
  console.log(`LENDING_POOL_ADDRESS=${poolAddress}`);
  console.log(`CREDIT_SCORE_ORACLE_ADDRESS=${oracleAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
