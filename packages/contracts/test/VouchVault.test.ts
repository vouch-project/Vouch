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
      await expect(tx)
        .to.emit(vault, 'LoanCreated')
        .withArgs(0, owner.address, ethers.ZeroAddress, sentCollateral, (timestamp: bigint) => timestamp > 0n);
      const loan = await vault.getLoan(0);
      expect(loan[0]).to.equal(owner.address);
      expect(loan[1]).to.equal(ethers.ZeroAddress);
      expect(loan[2]).to.equal(sentCollateral);
      expect(loan[4]).to.equal(true); // active
      expect(await vault.balanceOf(owner.address)).to.equal(0);
      expect(await vault.lockedBalanceOf(owner.address)).to.equal(sentCollateral);
      expect(await vault.loanLockedBalanceOf(0)).to.equal(sentCollateral);

      const locked = await vault.getLoanLockedCollateral(0);
      expect(locked[0]).to.equal(ethers.ZeroAddress);
      expect(locked[1]).to.equal(sentCollateral);
      expect(locked[2]).to.equal(true);
    });

    it('Should fail if collateral is zero', async function () {
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await VouchVault.deploy();

      await expect(vault.createLoan({ value: 0 })).to.be.revertedWith('Collateral must be > 0');
    });

    it('Should not allow withdrawing active ETH loan collateral', async function () {
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await VouchVault.deploy();
      const collateral = ethers.parseEther('1.0');

      await vault.createLoan({ value: collateral });

      await expect(vault.withdraw(collateral)).to.be.revertedWith('Insufficient balance');
    });

    it('Should not allow releasing locked ETH loan collateral', async function () {
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await VouchVault.deploy();
      const collateral = ethers.parseEther('1.0');

      await vault.createLoan({ value: collateral });

      await expect(vault.releaseLoanCollateral(0)).to.be.revertedWith('Collateral release disabled');
    });

    it('Should lock ERC20 collateral per loan', async function () {
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');

      const vault = await VouchVault.deploy();
      const [owner] = await ethers.getSigners();

      const totalSupply = ethers.parseUnits('1000', 18);
      const collateral = ethers.parseUnits('50', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      await token.approve(await vault.getAddress(), collateral);
      await vault.createLoanWithERC20(await token.getAddress(), collateral);

      const loan = await vault.getLoan(0);
      expect(loan[0]).to.equal(owner.address);
      expect(loan[1]).to.equal(await token.getAddress());
      expect(loan[2]).to.equal(collateral);
      expect(loan[4]).to.equal(true);

      const locked = await vault.getLoanLockedCollateral(0);
      expect(locked[0]).to.equal(await token.getAddress());
      expect(locked[1]).to.equal(collateral);
      expect(locked[2]).to.equal(true);

      await expect(vault.releaseLoanCollateral(0)).to.be.revertedWith('Collateral release disabled');
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
