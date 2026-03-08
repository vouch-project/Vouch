import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { LendingPool } from '../typechain-types';

describe('LendingPool', function () {
  let lendingPool: LendingPool;
  let owner: SignerWithAddress;
  let borrower: SignerWithAddress;
  let lender: SignerWithAddress;

  beforeEach(async function () {
    [owner, borrower, lender] = await ethers.getSigners();

    const LendingPool = await ethers.getContractFactory('LendingPool');
    lendingPool = await LendingPool.deploy();
    await lendingPool.waitForDeployment();
  });

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      expect(await lendingPool.owner()).to.equal(owner.address);
    });

    it('Should initialize loan counter to 0', async function () {
      expect(await lendingPool.loanCounter()).to.equal(0);
    });
  });

  // Add more tests here
});
