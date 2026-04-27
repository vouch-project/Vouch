import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';

describe('VouchVault', function () {
  it('Should accept deposits', async function () {
    const [owner] = await ethers.getSigners();
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

    const depositAmount = ethers.parseEther('1.0');

    await vault.deposit({ value: depositAmount });
    expect(await vault.balanceOf(owner.address)).to.equal(depositAmount);
  });

  describe('createLoan', function () {
    it('Should create a loan with collateral', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const sentCollateral = ethers.parseEther('1.0');

      const tx = await vault.createLoan(ethers.ZeroAddress, sentCollateral, { value: sentCollateral });
      await expect(tx)
        .to.emit(vault, 'LoanCreated')
        .withArgs(
          0,
          owner.address,
          ethers.ZeroAddress,
          sentCollateral,
          ethers.ZeroAddress,
          sentCollateral,
          (timestamp: bigint) => timestamp > 0n,
        );
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
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      await expect(vault.createLoan(ethers.ZeroAddress, ethers.parseEther('1.0'), { value: 0 })).to.be.revertedWith(
        'Collateral must be > 0',
      );
    });

    it('Should not allow withdrawing active ETH loan collateral', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');

      await vault.createLoan(ethers.ZeroAddress, collateral, { value: collateral });

      await expect(vault.withdraw(collateral)).to.be.revertedWith('Insufficient balance');
    });

    it('Should not allow releasing locked ETH loan collateral', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');

      await vault.createLoan(ethers.ZeroAddress, collateral, { value: collateral });

      await expect(vault.releaseLoanCollateral(0)).to.be.revertedWith('Collateral release disabled');
    });

    it('Should lock ERC20 collateral per loan', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');

      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const totalSupply = ethers.parseUnits('1000', 18);
      const collateral = ethers.parseUnits('50', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      await token.approve(await vault.getAddress(), collateral);
      await vault.createLoanWithERC20(await token.getAddress(), collateral, ethers.ZeroAddress, collateral);

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
    const [owner] = await ethers.getSigners();
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

    const depositAmount = ethers.parseEther('1.0');
    await vault.deposit({ value: depositAmount });

    await vault.withdraw(depositAmount);
    expect(await vault.balanceOf(owner.address)).to.equal(0);
  });

  describe('fundLoan', function () {
    async function deployWithLoan() {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('0.5');
      const principal = ethers.parseEther('1.0');
      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, { value: collateral });
      return { vault, owner, borrower, lender, collateral };
    }

    it('Should fund a loan and transfer principal to borrower', async function () {
      const { vault, borrower, lender } = await deployWithLoan();
      const principal = ethers.parseEther('2.0');

      const borrowerBefore = await ethers.provider.getBalance(borrower.address);
      const tx = await vault.connect(lender).fundLoan(0, { value: principal });
      const borrowerAfter = await ethers.provider.getBalance(borrower.address);

      await expect(tx)
        .to.emit(vault, 'LoanFunded')
        .withArgs(0, lender.address, borrower.address, principal, (ts: bigint) => ts > 0n);

      expect(borrowerAfter - borrowerBefore).to.equal(principal);
    });

    it('Should record funding details correctly', async function () {
      const { vault, lender } = await deployWithLoan();
      const principal = ethers.parseEther('1.5');

      await vault.connect(lender).fundLoan(0, { value: principal });

      const details = await vault.getFundingDetails(0);
      expect(details[0]).to.equal(lender.address); // lender
      expect(details[1]).to.equal(principal); // principalAmount
      expect(details[2]).to.equal(true); // funded
      expect(details[3]).to.be.greaterThan(0n); // fundedAt
    });

    it('Should fail if loan does not exist (inactive)', async function () {
      const { vault, lender } = await deployWithLoan();
      await expect(vault.connect(lender).fundLoan(999, { value: ethers.parseEther('1.0') })).to.be.revertedWith(
        'Loan is not active',
      );
    });

    it('Should fail if loan is already funded', async function () {
      const { vault, lender } = await deployWithLoan();
      const principal = ethers.parseEther('1.0');

      await vault.connect(lender).fundLoan(0, { value: principal });

      await expect(vault.connect(lender).fundLoan(0, { value: principal })).to.be.revertedWith('Loan already funded');
    });

    it('Should fail if borrower tries to fund own loan', async function () {
      const { vault, borrower } = await deployWithLoan();
      await expect(vault.connect(borrower).fundLoan(0, { value: ethers.parseEther('1.0') })).to.be.revertedWith(
        'Borrower cannot fund own loan',
      );
    });

    it('Should fail if funding amount is zero', async function () {
      const { vault, lender } = await deployWithLoan();
      await expect(vault.connect(lender).fundLoan(0, { value: 0 })).to.be.revertedWith('Funding amount must be > 0');
    });

    it('Should not affect collateral tracking when funded', async function () {
      const { vault, borrower, lender, collateral } = await deployWithLoan();
      const principal = ethers.parseEther('1.0');

      await vault.connect(lender).fundLoan(0, { value: principal });

      // Collateral remains locked
      expect(await vault.lockedBalanceOf(borrower.address)).to.equal(collateral);
      expect(await vault.loanLockedBalanceOf(0)).to.equal(collateral);
      const locked = await vault.getLoanLockedCollateral(0);
      expect(locked[2]).to.equal(true);
    });
  });
});
