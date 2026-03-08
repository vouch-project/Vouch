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
