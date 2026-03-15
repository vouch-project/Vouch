import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('VouchVault', function () {
  it('Should accept deposits', async function () {
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await VouchVault.deploy();

    const [owner] = await ethers.getSigners();
    const depositAmount = ethers.parseEther('1.0');

    await vault.deposit({ value: depositAmount });
    expect(await vault.balanceOf(owner.address)).to.equal(depositAmount);
  });

  describe('createLoan', function () {
    it('Should create a loan with collateral', async function () {
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await VouchVault.deploy();
      const [owner] = await ethers.getSigners();
      const sentCollateral = ethers.parseEther('1.0');

      const tx = await vault.createLoan({ value: sentCollateral });
      await expect(tx).to.emit(vault, 'LoanCreated').withArgs(0, owner.address, sentCollateral);
      const loan = await vault.getLoan(0);
      expect(loan[0]).to.equal(owner.address);
      expect(loan[1]).to.equal(sentCollateral);
      expect(loan[3]).to.equal(true); // active
      expect(await vault.balanceOf(owner.address)).to.equal(sentCollateral);
    });

    it('Should fail if collateral is zero', async function () {
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await VouchVault.deploy();

      await expect(vault.createLoan({ value: 0 })).to.be.revertedWith('Collateral must be > 0');
    });
  });

  it('Should allow withdrawals', async function () {
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await VouchVault.deploy();

    const depositAmount = ethers.parseEther('1.0');
    await vault.deposit({ value: depositAmount });

    await vault.withdraw(depositAmount);
    const [owner] = await ethers.getSigners();
    expect(await vault.balanceOf(owner.address)).to.equal(0);
  });
});
