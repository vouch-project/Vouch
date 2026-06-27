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

      const fundWindow = 7n * 86400n; // 7 days
      const tx = await vault.createLoan(ethers.ZeroAddress, sentCollateral, 500, 86400, fundWindow, {
        value: sentCollateral,
      });
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

      // fundDeadline = createdAt + fundWindow
      const created = await vault.loans(0);
      expect(created.fundDeadline).to.equal(created.createdAt + fundWindow);
      expect(created.principalRepaid).to.equal(0);

      const repaymentDetails = await vault.getRepaymentDetails(0);
      expect(repaymentDetails[0]).to.equal(500); // interestRateBps
      expect(repaymentDetails[1]).to.equal(86400); // durationSeconds
      expect(repaymentDetails[2]).to.equal(false); // repaid
      expect(repaymentDetails[3]).to.equal(0); // totalDue (not funded)
      expect(repaymentDetails[4]).to.equal(0); // amountRepaid
      expect(repaymentDetails[5]).to.equal(0); // remaining
      expect(repaymentDetails[6]).to.equal(created.fundDeadline); // fundDeadline
    });

    it('Should fail if collateral is zero', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      await expect(
        vault.createLoan(ethers.ZeroAddress, ethers.parseEther('1.0'), 0, 0, 7n * 86400n, { value: 0 }),
      ).to.be.revertedWith('Collateral must be > 0');
    });

    it('Should fail if fund window is zero', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 0, 86400, 0, { value: collateral }),
      ).to.be.revertedWith('Fund window must be > 0');
    });

    it('reverts when the interest rate exceeds 100% (10000 bps cap)', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');
      // Above the cap (10001 bps = 100.01% APR) is rejected.
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 10001, 86400, 7n * 86400n, { value: collateral }),
      ).to.be.revertedWith('Interest rate cannot exceed 100%');
      // Exactly at the cap (10000 bps = 100% APR) is accepted.
      await expect(vault.createLoan(ethers.ZeroAddress, collateral, 10000, 86400, 7n * 86400n, { value: collateral }))
        .to.not.be.reverted;
      const loan = await vault.loans(0);
      expect(loan.interestRateBps).to.equal(10000n);
    });

    it('Should not allow withdrawing active ETH loan collateral', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');

      await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, { value: collateral });

      await expect(vault.withdraw(collateral)).to.be.revertedWith('Insufficient balance');
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
      await vault.createLoanWithERC20(
        await token.getAddress(),
        collateral,
        ethers.ZeroAddress,
        collateral,
        0,
        0,
        7n * 86400n,
      );

      const loan = await vault.getLoan(0);
      expect(loan[0]).to.equal(owner.address);
      expect(loan[1]).to.equal(await token.getAddress());
      expect(loan[2]).to.equal(collateral);
      expect(loan[4]).to.equal(true);

      const locked = await vault.getLoanLockedCollateral(0);
      expect(locked[0]).to.equal(await token.getAddress());
      expect(locked[1]).to.equal(collateral);
      expect(locked[2]).to.equal(true);
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
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 86400, 7n * 86400n, { value: collateral });
      return { vault, owner, borrower, lender, collateral, principal };
    }

    it('Should fund a loan and transfer principal to borrower', async function () {
      const { vault, borrower, lender, principal } = await deployWithLoan();

      const borrowerBefore = await ethers.provider.getBalance(borrower.address);
      const tx = await vault.connect(lender).fundLoan(0, { value: principal });

      await expect(tx)
        .to.emit(vault, 'LoanFunded')
        .withArgs(0, lender.address, borrower.address, principal, (ts: bigint) => ts > 0n);

      const borrowerAfter = await ethers.provider.getBalance(borrower.address);

      expect(borrowerAfter - borrowerBefore).to.equal(principal);
    });

    it('Should record funding details correctly', async function () {
      const { vault, lender, principal } = await deployWithLoan();

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

    it('Should fail if msg.value does not equal requestedPrincipalAmount', async function () {
      const { vault, lender, principal } = await deployWithLoan();
      await expect(vault.connect(lender).fundLoan(0, { value: principal - 1n })).to.be.revertedWith(
        'msg.value must equal requested principal amount',
      );
      await expect(vault.connect(lender).fundLoan(0, { value: principal + 1n })).to.be.revertedWith(
        'msg.value must equal requested principal amount',
      );
      await expect(vault.connect(lender).fundLoan(0, { value: 0 })).to.be.revertedWith(
        'msg.value must equal requested principal amount',
      );
    });

    it('Should fail if loan requests an ERC20 principal', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      await token.transfer(borrower.address, collateral);
      await token.connect(borrower).approve(await vault.getAddress(), collateral);
      await vault
        .connect(borrower)
        .createLoanWithERC20(
          await token.getAddress(),
          collateral,
          await token.getAddress(),
          principalAmount,
          0,
          0,
          7n * 86400n,
        );

      await expect(vault.connect(lender).fundLoan(0, { value: ethers.parseEther('1.0') })).to.be.revertedWith(
        'Token does not match requested principal token',
      );
    });

    it('reverts when funding after the fund window has passed', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('2.0');
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 86400, 3n * 86400n, { value: collateral }); // 3-day window
      await ethers.provider.send('evm_increaseTime', [4 * 86400]); // past the window
      await ethers.provider.send('evm_mine', []);
      await expect(vault.connect(lender).fundLoan(0, { value: principal })).to.be.revertedWith('Funding window passed');
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

  describe('fundLoanWithERC20', function () {
    it('Should fund an ERC20-principal loan and transfer tokens to borrower', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const totalSupply = ethers.parseUnits('1000', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principalAmount, 0, 0, 7n * 86400n, { value: collateral });

      await token.transfer(lender.address, principalAmount);
      await token.connect(lender).approve(await vault.getAddress(), principalAmount);

      const borrowerBefore = await token.balanceOf(borrower.address);
      const tx = await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount);

      await expect(tx)
        .to.emit(vault, 'LoanFunded')
        .withArgs(0, lender.address, borrower.address, principalAmount, (ts: bigint) => ts > 0n);

      const borrowerAfter = await token.balanceOf(borrower.address);
      expect(borrowerAfter - borrowerBefore).to.equal(principalAmount);

      const details = await vault.getFundingDetails(0);
      expect(details[0]).to.equal(lender.address);
      expect(details[1]).to.equal(principalAmount);
      expect(details[2]).to.equal(true);
      expect(details[3]).to.be.greaterThan(0n);
    });

    it('Should fail if loan requests native ETH principal', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseEther('1.0');

      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principalAmount, 0, 0, 7n * 86400n, { value: collateral });

      await expect(
        vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount),
      ).to.be.revertedWith('Loan requires native ETH principal; use fundLoan');
    });

    it('reverts when funding after the fund window has passed', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const totalSupply = ethers.parseUnits('1000', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principalAmount, 0, 0, 3n * 86400n, { value: collateral }); // 3-day window

      await token.transfer(lender.address, principalAmount);
      await token.connect(lender).approve(await vault.getAddress(), principalAmount);

      await ethers.provider.send('evm_increaseTime', [4 * 86400]); // past the window
      await ethers.provider.send('evm_mine', []);

      await expect(
        vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount),
      ).to.be.revertedWith('Funding window passed');
    });
  });

  describe('repayLoan (ETH principal)', function () {
    async function deployFundedLoan(interestRateBps = 500) {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('2.0');
      const principal = ethers.parseEther('1.0');

      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, interestRateBps, 86400, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      // Per-day accrual: no time is advanced after funding, so 0 whole days elapse
      // and accrued interest is 0 → totalDue == principal regardless of the rate.
      const interest = 0n;
      const totalDue = principal + interest;
      return { vault, owner, borrower, lender, collateral, principal, interest, totalDue };
    }

    it('applies partial payment to interest first, releases collateral by principal', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const interest = (principal * 3650n * 10n) / (10000n * 365n);

      const tx = await vault.connect(borrower).repayLoan(0, { value: interest });
      await tx.wait();
      const loan = await vault.loans(0);
      expect(loan.amountRepaid).to.equal(interest);
      expect(loan.principalRepaid).to.equal(0);
      expect(loan.collateralReleased).to.equal(0);
      expect(loan.repaid).to.equal(false);
    });

    it('full repayment after accrual closes loan and returns all collateral', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const interest = (principal * 3650n * 10n) / (10000n * 365n);
      const totalDue = principal + interest;

      await vault.connect(borrower).repayLoan(0, { value: totalDue });
      const loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);
      expect(loan.active).to.equal(false);
      expect(loan.collateralLocked).to.equal(false);
      expect(loan.principalRepaid).to.equal(principal);
      expect(loan.collateralReleased).to.equal(collateral);
    });

    it('Should repay loan in full and return all collateral to borrower', async function () {
      const { vault, borrower, lender, collateral, principal, interest, totalDue } = await deployFundedLoan();

      const lenderBefore = await ethers.provider.getBalance(lender.address);
      const borrowerBefore = await ethers.provider.getBalance(borrower.address);

      const tx = await vault.connect(borrower).repayLoan(0, { value: totalDue });
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      await expect(tx)
        .to.emit(vault, 'LoanRepaid')
        .withArgs(0, borrower.address, lender.address, principal, interest, totalDue, (ts: bigint) => ts > 0n);

      // An EOA lender accepts ETH, so the hybrid payout pushes directly (no pending credit).
      const lenderAfter = await ethers.provider.getBalance(lender.address);
      const borrowerAfter = await ethers.provider.getBalance(borrower.address);

      expect(lenderAfter - lenderBefore).to.equal(totalDue);
      expect(borrowerAfter - borrowerBefore).to.equal(collateral - totalDue - gasUsed);
      expect(await vault.pendingPayments(lender.address, ethers.ZeroAddress)).to.equal(0n);
    });

    it('Should mark loan as inactive and repaid after full payment', async function () {
      const { vault, borrower, totalDue } = await deployFundedLoan();

      await vault.connect(borrower).repayLoan(0, { value: totalDue });

      const loan = await vault.getLoan(0);
      expect(loan[4]).to.equal(false); // active = false

      const rd = await vault.getRepaymentDetails(0);
      expect(rd[2]).to.equal(true); // repaid
      // No days elapsed → accrued interest is 0, so totalDue == principal here.
      expect(rd[4]).to.equal(totalDue); // amountRepaid == totalDue paid
      expect(rd[5]).to.equal(0n); // remaining == 0
    });

    it('Should unlock collateral tracking after full repayment', async function () {
      const { vault, borrower, totalDue } = await deployFundedLoan();

      await vault.connect(borrower).repayLoan(0, { value: totalDue });

      expect(await vault.lockedBalanceOf(borrower.address)).to.equal(0);
      const locked = await vault.getLoanLockedCollateral(0);
      expect(locked[2]).to.equal(false);
    });

    it('Should work with zero interest rate', async function () {
      const { vault, borrower, lender, principal } = await deployFundedLoan(0);

      const lenderBefore = await ethers.provider.getBalance(lender.address);
      const tx = await vault.connect(borrower).repayLoan(0, { value: principal });
      await expect(tx)
        .to.emit(vault, 'LoanRepaid')
        .withArgs(0, borrower.address, lender.address, principal, 0n, principal, (ts: bigint) => ts > 0n);

      const lenderAfter = await ethers.provider.getBalance(lender.address);
      expect(lenderAfter - lenderBefore).to.equal(principal);
    });

    it('Should fail if payment exceeds remaining balance', async function () {
      const { vault, borrower, totalDue } = await deployFundedLoan();

      await expect(vault.connect(borrower).repayLoan(0, { value: totalDue + 1n })).to.be.revertedWith(
        'Payment exceeds amount owed',
      );
    });

    it('Should fail if payment is zero', async function () {
      const { vault, borrower } = await deployFundedLoan();

      await expect(vault.connect(borrower).repayLoan(0, { value: 0 })).to.be.revertedWith('Payment must be > 0');
    });

    it('Should fail if called by non-borrower', async function () {
      const { vault, lender, totalDue } = await deployFundedLoan();

      await expect(vault.connect(lender).repayLoan(0, { value: totalDue })).to.be.revertedWith(
        'Only borrower can repay',
      );
    });

    it('Should fail if loan is not funded', async function () {
      const [owner, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');

      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, { value: collateral });

      await expect(vault.connect(borrower).repayLoan(0, { value: collateral })).to.be.revertedWith(
        'Loan is not funded',
      );
    });

    it('Should fail on double repayment', async function () {
      const { vault, borrower, totalDue } = await deployFundedLoan();

      await vault.connect(borrower).repayLoan(0, { value: totalDue });

      await expect(vault.connect(borrower).repayLoan(0, { value: totalDue })).to.be.revertedWith('Loan already repaid');
    });

    it('Should fail if loan has ERC20 principal', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principalAmount, 500, 0, 7n * 86400n, { value: collateral });
      await token.transfer(lender.address, principalAmount);
      await token.connect(lender).approve(await vault.getAddress(), principalAmount);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount);

      await expect(vault.connect(borrower).repayLoan(0, { value: ethers.parseEther('1.1') })).to.be.revertedWith(
        'Loan has ERC20 principal; use repayLoanWithERC20',
      );
    });

    describe('partial repayments', function () {
      it('Should release proportional collateral on each partial payment', async function () {
        const { vault, borrower, lender, collateral, principal, totalDue } = await deployFundedLoan(1000); // 10%
        // No days elapsed → accrued interest is 0, so totalDue == principal (1 ETH), collateral = 2 ETH.
        // Pay 50% of totalDue → that 50% is all principal → expect ~50% collateral back

        const half = totalDue / 2n;
        const expectedCollateralRelease = (collateral * half) / totalDue;

        const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);
        const tx = await vault.connect(borrower).repayLoan(0, { value: half });
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

        await expect(tx)
          .to.emit(vault, 'LoanPartiallyRepaid')
          .withArgs(0, borrower.address, half, expectedCollateralRelease, half, totalDue, (ts: bigint) => ts > 0n);

        const borrowerEthAfter = await ethers.provider.getBalance(borrower.address);
        // net change: -half (payment) - gas + collateral released
        expect(borrowerEthAfter - borrowerEthBefore).to.equal(expectedCollateralRelease - half - gasUsed);

        // Loan still active
        const loan = await vault.getLoan(0);
        expect(loan[4]).to.equal(true);

        // getRepaymentDetails reflects progress. totalDue here is per-day accrued
        // (durationSeconds=86400, 0 whole days elapsed → 0 interest → due == principal).
        const rd = await vault.getRepaymentDetails(0);
        expect(rd[4]).to.equal(half); // amountRepaid (half paid)
        expect(rd[5]).to.equal(principal - half); // remaining = accrued due(=principal) - amountRepaid
      });

      it('Should report remaining locked collateral via view helpers after a partial payment', async function () {
        const { vault, borrower, collateral, totalDue } = await deployFundedLoan(1000);

        const half = totalDue / 2n;
        const expectedCollateralRelease = (collateral * half) / totalDue;
        const expectedStillLocked = collateral - expectedCollateralRelease;

        await vault.connect(borrower).repayLoan(0, { value: half });

        // Both helpers must report what's STILL locked, not the original deposit.
        expect(await vault.loanLockedBalanceOf(0)).to.equal(expectedStillLocked);
        const locked = await vault.getLoanLockedCollateral(0);
        expect(locked[1]).to.equal(expectedStillLocked); // collateralAmount = remaining
        expect(locked[2]).to.equal(true); // still locked (loan not fully repaid)
      });

      it('Should forward each partial payment to the lender', async function () {
        const { vault, borrower, lender, totalDue } = await deployFundedLoan(500);

        const third = totalDue / 3n;
        const lenderBefore = await ethers.provider.getBalance(lender.address);

        await vault.connect(borrower).repayLoan(0, { value: third });

        const lenderAfter = await ethers.provider.getBalance(lender.address);
        expect(lenderAfter - lenderBefore).to.equal(third);
      });

      it('Should recover all collateral across multiple partial payments with no dust lost', async function () {
        const { vault, borrower, collateral, totalDue } = await deployFundedLoan(500);

        // Three uneven payments
        const p1 = totalDue / 3n;
        const p2 = totalDue / 3n;
        const p3 = totalDue - p1 - p2; // final payment cleans up remainder

        await vault.connect(borrower).repayLoan(0, { value: p1 });
        await vault.connect(borrower).repayLoan(0, { value: p2 });

        // Before final payment: some collateral already released
        expect(await vault.lockedBalanceOf(borrower.address)).to.be.lessThan(collateral);

        const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);
        const tx = await vault.connect(borrower).repayLoan(0, { value: p3 });
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const borrowerEthAfter = await ethers.provider.getBalance(borrower.address);

        // All collateral returned across all payments, net of final payment + gas
        // Total collateral in = collateral; total paid out = totalDue; net = collateral - totalDue - gas (for final tx)
        // But we need to account for the fact that p1 and p2 already returned some collateral.
        // The key invariant: after full repayment, lockedEthCollateral == 0 and collateralLocked == false
        expect(await vault.lockedBalanceOf(borrower.address)).to.equal(0);
        const locked = await vault.getLoanLockedCollateral(0);
        expect(locked[2]).to.equal(false);

        // Loan is closed
        const loan = await vault.getLoan(0);
        expect(loan[4]).to.equal(false); // active = false

        const rd = await vault.getRepaymentDetails(0);
        expect(rd[2]).to.equal(true); // repaid
        expect(rd[5]).to.equal(0n); // remaining = 0
      });

      it('Should fail on a payment that would exceed the remaining balance', async function () {
        const { vault, borrower, totalDue } = await deployFundedLoan(500);

        const half = totalDue / 2n;
        await vault.connect(borrower).repayLoan(0, { value: half });

        const remaining = totalDue - half;
        await expect(vault.connect(borrower).repayLoan(0, { value: remaining + 1n })).to.be.revertedWith(
          'Payment exceeds amount owed',
        );
      });

      it('Should allow paying exactly the remaining balance to close the loan', async function () {
        const { vault, borrower, totalDue } = await deployFundedLoan(500);

        const half = totalDue / 2n;
        await vault.connect(borrower).repayLoan(0, { value: half });

        const remaining = totalDue - half;
        const tx = await vault.connect(borrower).repayLoan(0, { value: remaining });
        await expect(tx).to.emit(vault, 'LoanRepaid');

        const loan = await vault.getLoan(0);
        expect(loan[4]).to.equal(false);
      });

      it('releases collateral strictly by principal across the interest->principal boundary', async function () {
        const [owner, borrower, lender] = await ethers.getSigners();
        const VouchVault = await ethers.getContractFactory('VouchVault');
        const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

        const principal = ethers.parseEther('1.0');
        const collateral = ethers.parseEther('5.0');
        const interestRateBps = 3650n; // 36.5% APR
        const durationDays = 30n;
        const elapsedDays = 10n;

        await vault
          .connect(borrower)
          .createLoan(ethers.ZeroAddress, principal, Number(interestRateBps), durationDays * 86400n, 7n * 86400n, {
            value: collateral,
          });
        await vault.connect(lender).fundLoan(0, { value: principal });

        // Advance exactly 10 whole days (well inside the 30-day cap) and repay immediately.
        await ethers.provider.send('evm_increaseTime', [Number(elapsedDays) * 86400]);
        await ethers.provider.send('evm_mine', []);

        // accrued = principal * rateBps * elapsedDays / (10000 * 365)
        const accrued = (principal * interestRateBps * elapsedDays) / (10000n * 365n);

        // Self-check: getRepaymentDetails reports totalDue == principal + accrued.
        const rd = await vault.getRepaymentDetails(0);
        expect(rd[3]).to.equal(principal + accrued);

        // Payment 1: strictly LESS than accrued interest -> all interest, zero principal, zero collateral.
        const payment1 = accrued / 5n; // < accrued
        expect(payment1).to.be.lessThan(accrued);
        await vault.connect(borrower).repayLoan(0, { value: payment1 });

        let loan = await vault.loans(0);
        expect(loan.amountRepaid).to.equal(payment1);
        // interestPaid = min(amountRepaid, accrued) = payment1; principalRepaid = 0.
        expect(loan.principalRepaid).to.equal(0n);
        expect(loan.collateralReleased).to.equal(0n);
        expect(loan.repaid).to.equal(false);

        // Payment 2: CROSSES the boundary. amountRepaid = payment1 + payment2 > accrued.
        // Sized so it pays the remaining interest AND reduces some principal.
        const payment2 = accrued - payment1 + accrued; // remaining interest + an equal principal slice
        const amountRepaidAfter = payment1 + payment2;

        // Expected interest-first split after payment 2.
        const interestPaid = amountRepaidAfter < accrued ? amountRepaidAfter : accrued; // == accrued
        const newPrincipalRepaid = amountRepaidAfter - interestPaid;
        const principalDelta = newPrincipalRepaid - 0n; // previous principalRepaid was 0

        // The boundary-crossing property: principal moved is strictly less than the cash paid.
        expect(principalDelta).to.be.lessThan(payment2);

        // Collateral released this payment is proportional to PRINCIPAL repaid, not cash paid.
        const expectedCollateralReleased = (collateral * principalDelta) / principal;

        await vault.connect(borrower).repayLoan(0, { value: payment2 });

        loan = await vault.loans(0);
        expect(loan.amountRepaid).to.equal(amountRepaidAfter);
        expect(loan.principalRepaid).to.equal(newPrincipalRepaid);
        expect(loan.collateralReleased).to.equal(expectedCollateralReleased);
        expect(loan.repaid).to.equal(false);
      });

      it('does not revert when interest accrues further between an early principal payment and a later small payment', async function () {
        // Regression: previously the cumulative split recomputed principalRepaid from the
        // current (growing) accrued, so a small later payment could make the new principal
        // figure drop below the stored one and underflow principalDelta, reverting the borrower's
        // payment. principalRepaid must be monotonic.
        const [owner, borrower, lender] = await ethers.getSigners();
        const VouchVault = await ethers.getContractFactory('VouchVault');
        const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

        const principal = ethers.parseEther('1.0');
        const collateral = ethers.parseEther('5.0');
        const interestRateBps = 3650n; // 36.5% APR

        await vault
          .connect(borrower)
          .createLoan(ethers.ZeroAddress, principal, Number(interestRateBps), 60n * 86400n, 7n * 86400n, {
            value: collateral,
          });
        await vault.connect(lender).fundLoan(0, { value: principal });

        // Day 5: accrued5 = principal * 3650 * 5 / (10000*365) = 0.005 ETH.
        await ethers.provider.send('evm_increaseTime', [5 * 86400]);
        await ethers.provider.send('evm_mine', []);
        const accrued5 = (principal * interestRateBps * 5n) / (10000n * 365n);

        // Pay slightly more than the accrued interest so some principal is credited.
        const payment1 = accrued5 + ethers.parseEther('0.001');
        await vault.connect(borrower).repayLoan(0, { value: payment1 });

        let loan = await vault.loans(0);
        const principalRepaidAfter1 = payment1 - accrued5; // 0.001 ETH credited to principal
        expect(loan.principalRepaid).to.equal(principalRepaidAfter1);
        const collateralAfter1 = (collateral * principalRepaidAfter1) / principal;
        expect(loan.collateralReleased).to.equal(collateralAfter1);

        // Day 20: accrued grows to 0.02 ETH (>> interest already paid). A tiny payment that is
        // entirely interest must NOT revert and must NOT reduce principalRepaid.
        await ethers.provider.send('evm_increaseTime', [15 * 86400]);
        await ethers.provider.send('evm_mine', []);

        const payment2 = ethers.parseEther('0.0005');
        await expect(vault.connect(borrower).repayLoan(0, { value: payment2 })).to.not.be.reverted;

        loan = await vault.loans(0);
        // principalRepaid unchanged (payment2 was all interest), collateralReleased unchanged.
        expect(loan.principalRepaid).to.equal(principalRepaidAfter1);
        expect(loan.collateralReleased).to.equal(collateralAfter1);
        expect(loan.amountRepaid).to.equal(payment1 + payment2);
        expect(loan.repaid).to.equal(false);
      });
    });
  });

  describe('repayLoanWithERC20 (ERC20 principal)', function () {
    async function deployFundedERC20Loan(interestRateBps = 1000) {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('10000', 18));
      const collateral = ethers.parseEther('1.0');
      const principalAmount = ethers.parseUnits('100', 18);
      // Interest is now per-day simple interest capped at durationSeconds. Use a 30-day duration
      // so a single fixed amount of interest accrues once the cap is reached (see below).
      const durationSeconds = 30n * 86400n;

      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principalAmount, interestRateBps, durationSeconds, 7n * 86400n, {
          value: collateral,
        });

      await token.transfer(lender.address, principalAmount);
      await token.connect(lender).approve(await vault.getAddress(), principalAmount);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount);

      // Advance past the duration so accrued interest reaches its cap and is fixed thereafter.
      await ethers.provider.send('evm_increaseTime', [Number(durationSeconds) + 86400]);
      await ethers.provider.send('evm_mine', []);

      // Per-day simple interest, floored to whole days and capped at durationSeconds (30 days).
      const interest = (principalAmount * BigInt(interestRateBps) * 30n) / (10000n * 365n);
      const totalDue = principalAmount + interest;

      // Give borrower enough to cover interest (they already received the principal)
      await token.transfer(borrower.address, interest);

      return { vault, owner, borrower, lender, token, collateral, principalAmount, interest, totalDue };
    }

    it('Should repay ERC20 loan in full, forward tokens to lender, return ETH collateral', async function () {
      const { vault, owner, borrower, lender, token, collateral, principalAmount, interest, totalDue } =
        await deployFundedERC20Loan();

      await token.connect(borrower).approve(await vault.getAddress(), totalDue);

      const lenderTokenBefore = await token.balanceOf(lender.address);
      const treasuryTokenBefore = await token.balanceOf(owner.address);
      const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);

      // Protocol takes the default 10% of the interest portion; lender gets the rest.
      const protocolFee = (interest * 1000n) / 10000n;

      const tx = await vault.connect(borrower).repayLoanWithERC20(0, totalDue);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      await expect(tx)
        .to.emit(vault, 'LoanRepaid')
        .withArgs(0, borrower.address, lender.address, principalAmount, interest, totalDue, (ts: bigint) => ts > 0n);
      await expect(tx)
        .to.emit(vault, 'ProtocolFeeCollected')
        .withArgs(0, await token.getAddress(), protocolFee);

      // EOA recipients accept the token, so the hybrid payout pushes directly.
      const lenderTokenAfter = await token.balanceOf(lender.address);
      expect(lenderTokenAfter - lenderTokenBefore).to.equal(totalDue - protocolFee);

      const treasuryTokenAfter = await token.balanceOf(owner.address);
      expect(treasuryTokenAfter - treasuryTokenBefore).to.equal(protocolFee);

      const borrowerEthAfter = await ethers.provider.getBalance(borrower.address);
      expect(borrowerEthAfter - borrowerEthBefore).to.equal(collateral - gasUsed);
    });

    it('Should repay ERC20 loan with ERC20 collateral and return ERC20 collateral', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const collateralToken = await MockERC20.deploy('Collateral', 'COL', 18, ethers.parseUnits('10000', 18));
      const principalToken = await MockERC20.deploy('Principal', 'PRI', 18, ethers.parseUnits('10000', 18));

      const collateral = ethers.parseUnits('200', 18);
      const principalAmount = ethers.parseUnits('100', 18);
      const interestRateBps = 500;
      const durationSeconds = 30n * 86400n;

      await collateralToken.transfer(borrower.address, collateral);
      await collateralToken.connect(borrower).approve(await vault.getAddress(), collateral);
      await vault
        .connect(borrower)
        .createLoanWithERC20(
          await collateralToken.getAddress(),
          collateral,
          await principalToken.getAddress(),
          principalAmount,
          interestRateBps,
          durationSeconds,
          7n * 86400n,
        );

      await principalToken.transfer(lender.address, principalAmount);
      await principalToken.connect(lender).approve(await vault.getAddress(), principalAmount);
      await vault.connect(lender).fundLoanWithERC20(0, await principalToken.getAddress(), principalAmount);

      // Advance past the duration so per-day interest accrues to its cap (fixed thereafter).
      await ethers.provider.send('evm_increaseTime', [Number(durationSeconds) + 86400]);
      await ethers.provider.send('evm_mine', []);
      const interest = (principalAmount * BigInt(interestRateBps) * 30n) / (10000n * 365n);
      const totalDue = principalAmount + interest;

      await principalToken.transfer(borrower.address, interest);
      await principalToken.connect(borrower).approve(await vault.getAddress(), totalDue);

      const collateralBefore = await collateralToken.balanceOf(borrower.address);
      await vault.connect(borrower).repayLoanWithERC20(0, totalDue);
      const collateralAfter = await collateralToken.balanceOf(borrower.address);

      expect(collateralAfter - collateralBefore).to.equal(collateral);
    });

    it('Should mark loan as inactive and repaid after full payment', async function () {
      const { vault, borrower, token, totalDue } = await deployFundedERC20Loan();

      await token.connect(borrower).approve(await vault.getAddress(), totalDue);
      await vault.connect(borrower).repayLoanWithERC20(0, totalDue);

      const loan = await vault.getLoan(0);
      expect(loan[4]).to.equal(false);

      const rd = await vault.getRepaymentDetails(0);
      expect(rd[2]).to.equal(true);
      expect(rd[5]).to.equal(0n);
    });

    it('Should fail if called by non-borrower', async function () {
      const { vault, lender, token, totalDue } = await deployFundedERC20Loan();

      await token.connect(lender).approve(await vault.getAddress(), totalDue);
      await expect(vault.connect(lender).repayLoanWithERC20(0, totalDue)).to.be.revertedWith('Only borrower can repay');
    });

    it('Should fail on double repayment', async function () {
      const { vault, borrower, token, totalDue } = await deployFundedERC20Loan();

      await token.connect(borrower).approve(await vault.getAddress(), totalDue);
      await vault.connect(borrower).repayLoanWithERC20(0, totalDue);

      await token.connect(borrower).approve(await vault.getAddress(), totalDue);
      await expect(vault.connect(borrower).repayLoanWithERC20(0, totalDue)).to.be.revertedWith('Loan already repaid');
    });

    it('Should fail if loan has ETH principal', async function () {
      const [owner, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');
      const principal = ethers.parseEther('0.5');

      const [, , lender] = await ethers.getSigners();
      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 0, 0, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      await expect(vault.connect(borrower).repayLoanWithERC20(0, principal)).to.be.revertedWith(
        'Loan has ETH principal; use repayLoan',
      );
    });

    it('Should fail if borrower has insufficient token allowance', async function () {
      const { vault, borrower, totalDue } = await deployFundedERC20Loan();

      await expect(vault.connect(borrower).repayLoanWithERC20(0, totalDue)).to.be.reverted;
    });

    it('Should fail if payment exceeds remaining balance', async function () {
      const { vault, borrower, token, totalDue } = await deployFundedERC20Loan();

      await token.connect(borrower).approve(await vault.getAddress(), totalDue + 1n);
      await expect(vault.connect(borrower).repayLoanWithERC20(0, totalDue + 1n)).to.be.revertedWith(
        'Payment exceeds amount owed',
      );
    });

    it('ERC20: full repayment after accrual closes loan and returns collateral', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const Token = await ethers.getContractFactory('MockERC20');
      const token = await Token.deploy('Mock', 'MOCK', 18, 0);
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principal, 3650, 30n * 86400n, 7n * 86400n, { value: collateral });
      await token.mint(lender.address, principal);
      await token.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principal);

      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const interest = (principal * 3650n * 10n) / (10000n * 365n);
      const totalDue = principal + interest;

      await token.mint(borrower.address, totalDue);
      await token.connect(borrower).approve(await vault.getAddress(), totalDue);
      await vault.connect(borrower).repayLoanWithERC20(0, totalDue);

      const loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);
      expect(loan.principalRepaid).to.equal(principal);
      expect(loan.collateralReleased).to.equal(collateral);
    });

    describe('partial repayments', function () {
      it('Should release proportional ERC20 collateral on partial payment and forward tokens to lender', async function () {
        const [owner, borrower, lender] = await ethers.getSigners();
        const VouchVault = await ethers.getContractFactory('VouchVault');
        const MockERC20 = await ethers.getContractFactory('MockERC20');
        const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

        const collateralToken = await MockERC20.deploy('COL', 'COL', 18, ethers.parseUnits('10000', 18));
        const principalToken = await MockERC20.deploy('PRI', 'PRI', 18, ethers.parseUnits('10000', 18));

        const collateral = ethers.parseUnits('200', 18);
        const principalAmount = ethers.parseUnits('100', 18);
        const interestRateBps = 1000; // 10% annual
        // durationSeconds == 0 below means no interest accrues (see _accruedInterest), so the
        // amount owed is exactly the principal under the per-day model.
        const interest = 0n;
        const totalDue = principalAmount + interest;

        await collateralToken.transfer(borrower.address, collateral);
        await collateralToken.connect(borrower).approve(await vault.getAddress(), collateral);
        await vault
          .connect(borrower)
          .createLoanWithERC20(
            await collateralToken.getAddress(),
            collateral,
            await principalToken.getAddress(),
            principalAmount,
            interestRateBps,
            0,
            7n * 86400n,
          );

        await principalToken.transfer(lender.address, principalAmount);
        await principalToken.connect(lender).approve(await vault.getAddress(), principalAmount);
        await vault.connect(lender).fundLoanWithERC20(0, await principalToken.getAddress(), principalAmount);

        // Give borrower tokens for interest portion
        await principalToken.transfer(borrower.address, interest);

        // Pay half. With accrued interest 0, principalDelta == half, so collateral release is
        // proportional to principal: collateral * half / principalAmount.
        const half = totalDue / 2n;
        const expectedCollateralRelease = (collateral * half) / principalAmount;

        await principalToken.connect(borrower).approve(await vault.getAddress(), half);

        const lenderTokenBefore = await principalToken.balanceOf(lender.address);
        const borrowerColBefore = await collateralToken.balanceOf(borrower.address);

        const tx = await vault.connect(borrower).repayLoanWithERC20(0, half);

        await expect(tx)
          .to.emit(vault, 'LoanPartiallyRepaid')
          .withArgs(0, borrower.address, half, expectedCollateralRelease, half, totalDue, (ts: bigint) => ts > 0n);

        const lenderTokenAfter = await principalToken.balanceOf(lender.address);
        const borrowerColAfter = await collateralToken.balanceOf(borrower.address);

        expect(lenderTokenAfter - lenderTokenBefore).to.equal(half);
        expect(borrowerColAfter - borrowerColBefore).to.equal(expectedCollateralRelease);

        // Loan still active
        const loan = await vault.getLoan(0);
        expect(loan[4]).to.equal(true);
      });

      it('Should recover all ERC20 collateral across multiple partial payments with no dust lost', async function () {
        const { vault, borrower, token, collateral, totalDue } = await deployFundedERC20Loan(500);

        const p1 = totalDue / 3n;
        const p2 = totalDue / 3n;
        const p3 = totalDue - p1 - p2;

        await token.connect(borrower).approve(await vault.getAddress(), p1);
        await vault.connect(borrower).repayLoanWithERC20(0, p1);

        await token.connect(borrower).approve(await vault.getAddress(), p2);
        await vault.connect(borrower).repayLoanWithERC20(0, p2);

        // Track ETH balance before final payment to measure collateral return
        const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);

        await token.connect(borrower).approve(await vault.getAddress(), p3);
        const tx = await vault.connect(borrower).repayLoanWithERC20(0, p3);
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const borrowerEthAfter = await ethers.provider.getBalance(borrower.address);

        // All ETH collateral returned minus gas (some already returned in p1/p2)
        // Key invariant: lockedEthCollateral == 0 and collateralLocked == false
        expect(await vault.lockedBalanceOf(borrower.address)).to.equal(0);
        const locked = await vault.getLoanLockedCollateral(0);
        expect(locked[2]).to.equal(false);

        const rd = await vault.getRepaymentDetails(0);
        expect(rd[2]).to.equal(true);
        expect(rd[5]).to.equal(0n);
      });

      it('ERC20: does not revert when interest accrues further between an early principal payment and a later small payment', async function () {
        // Regression mirror of the ETH case: a small later payment that is entirely interest must
        // NOT revert and must NOT reduce principalRepaid. principalRepaid must be monotonic.
        const [owner, borrower, lender] = await ethers.getSigners();
        const VouchVault = await ethers.getContractFactory('VouchVault');
        const MockERC20 = await ethers.getContractFactory('MockERC20');
        const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

        const token = await MockERC20.deploy('Mock', 'MOCK', 18, 0);
        const principal = ethers.parseEther('1.0');
        const collateral = ethers.parseEther('5.0');
        const interestRateBps = 3650n; // 36.5% APR

        await vault
          .connect(borrower)
          .createLoan(await token.getAddress(), principal, Number(interestRateBps), 60n * 86400n, 7n * 86400n, {
            value: collateral,
          });
        await token.mint(lender.address, principal);
        await token.connect(lender).approve(await vault.getAddress(), principal);
        await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principal);

        // Pre-fund the borrower with enough tokens (and allowance) for both payments upfront.
        const payment1 = (principal * interestRateBps * 5n) / (10000n * 365n) + ethers.parseEther('0.001');
        const payment2 = ethers.parseEther('0.0005');
        await token.mint(borrower.address, payment1 + payment2);
        await token.connect(borrower).approve(await vault.getAddress(), payment1 + payment2);

        // Day 5: accrued5 = principal * 3650 * 5 / (10000*365) = 0.005 ETH.
        await ethers.provider.send('evm_increaseTime', [5 * 86400]);
        await ethers.provider.send('evm_mine', []);
        const accrued5 = (principal * interestRateBps * 5n) / (10000n * 365n);

        // Pay slightly more than the accrued interest so some principal is credited.
        await vault.connect(borrower).repayLoanWithERC20(0, payment1);

        let loan = await vault.loans(0);
        const principalRepaidAfter1 = payment1 - accrued5; // 0.001 ETH credited to principal
        expect(loan.principalRepaid).to.equal(principalRepaidAfter1);
        const collateralAfter1 = (collateral * principalRepaidAfter1) / principal;
        expect(loan.collateralReleased).to.equal(collateralAfter1);

        // Day 20: accrued grows to 0.02 ETH (>> interest already paid). A tiny payment that is
        // entirely interest must NOT revert and must NOT reduce principalRepaid.
        await ethers.provider.send('evm_increaseTime', [15 * 86400]);
        await ethers.provider.send('evm_mine', []);

        await expect(vault.connect(borrower).repayLoanWithERC20(0, payment2)).to.not.be.reverted;

        loan = await vault.loans(0);
        // principalRepaid unchanged (payment2 was all interest), collateralReleased unchanged.
        expect(loan.principalRepaid).to.equal(principalRepaidAfter1);
        expect(loan.collateralReleased).to.equal(collateralAfter1);
        expect(loan.amountRepaid).to.equal(payment1 + payment2);
        expect(loan.repaid).to.equal(false);
      });
    });
  });

  describe('getRepaymentDetails', function () {
    it('Should return correct totalDue and remaining after funding and partial repayment', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      // 3650 bps APR over a 10-day term => interest = 1.0 * 3650 * 10 / (10000*365) = 0.01 ETH,
      // so once the full term has accrued (and is capped at it) totalDue == 1.01 ETH.
      const durationSeconds = 10n * 86400n;
      const expectedTotalDue = principal + (principal * 3650n * 10n) / (10000n * 365n);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, durationSeconds, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      // Advance past the term so accrued interest is capped at exactly 10 whole days (deterministic).
      await ethers.provider.send('evm_increaseTime', [11 * 86400]);
      await ethers.provider.send('evm_mine', []);

      const rd1 = await vault.getRepaymentDetails(0);
      expect(rd1[0]).to.equal(3650); // 36.5% APR
      expect(rd1[2]).to.equal(false); // not repaid
      expect(rd1[3]).to.equal(expectedTotalDue); // totalDue (principal + capped accrued interest)
      expect(rd1[4]).to.equal(0n); // amountRepaid
      expect(rd1[5]).to.equal(expectedTotalDue); // remaining

      // Partial payment (repayLoan still uses flat interest, but 0.5 is within remaining either way)
      const payment = ethers.parseEther('0.5');
      await vault.connect(borrower).repayLoan(0, { value: payment });

      const rd2 = await vault.getRepaymentDetails(0);
      expect(rd2[4]).to.equal(payment); // amountRepaid
      expect(rd2[5]).to.equal(expectedTotalDue - payment); // remaining (capped accrued due - amountRepaid)
      expect(rd2[2]).to.equal(false); // still not repaid
    });
  });

  describe('accrued interest (per-day APR, capped)', function () {
    async function deployFunded(interestRateBps = 3650, durationSeconds = 30n * 86400n) {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, interestRateBps, durationSeconds, 7n * 86400n, {
          value: collateral,
        });
      await vault.connect(lender).fundLoan(0, { value: principal });
      return { vault, owner, borrower, lender, principal, collateral };
    }

    it('accrues zero interest before any full day passes', async function () {
      const { vault, principal } = await deployFunded();
      const details = await vault.getRepaymentDetails(0);
      expect(details[3]).to.equal(principal); // totalDue == principal at 0 whole days
    });

    it('accrues per whole day at the annual rate', async function () {
      const { vault, principal } = await deployFunded(3650, 30n * 86400n);
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const details = await vault.getRepaymentDetails(0);
      const expectedInterest = (principal * 3650n * 10n) / (10000n * 365n);
      expect(details[3]).to.equal(principal + expectedInterest);
    });

    it('caps interest at the loan duration', async function () {
      const { vault, principal } = await deployFunded(3650, 5n * 86400n);
      await ethers.provider.send('evm_increaseTime', [100 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const details = await vault.getRepaymentDetails(0);
      const cappedInterest = (principal * 3650n * 5n) / (10000n * 365n);
      expect(details[3]).to.equal(principal + cappedInterest);
    });
  });

  describe('outstanding-balance interest & minimum floor', function () {
    async function deployFunded(interestRateBps = 3650, durationSeconds = 30n * 86400n) {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, interestRateBps, durationSeconds, 7n * 86400n, {
          value: collateral,
        });
      await vault.connect(lender).fundLoan(0, { value: principal });
      return { vault, owner, borrower, lender, principal, collateral };
    }

    it('charges interest only on the outstanding principal after an early principal payment', async function () {
      // 36.5% APR on 1 ETH => 0.001 ETH/day on the FULL principal.
      const { vault, borrower, principal } = await deployFunded(3650, 30n * 86400n);
      const perDayFull = (principal * 3650n) / (10000n * 365n); // 0.001 ETH

      // Day 10: clear the 0.01 ETH accrued interest + repay half the principal.
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const firstInterest = perDayFull * 10n; // 0.01 ETH on full principal
      const firstPayment = firstInterest + principal / 2n; // 0.51 ETH (0.01 interest + 0.5 principal)
      await vault.connect(borrower).repayLoan(0, { value: firstPayment });

      let loan = await vault.loans(0);
      expect(loan.principalRepaid).to.equal(principal / 2n);

      // Day 20: another 10 days, but now interest accrues on the remaining 0.5 ETH only.
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);

      // Pay off the rest using the contract's own remaining figure.
      const rd = await vault.getRepaymentDetails(0);
      const remaining = rd[5];
      await vault.connect(borrower).repayLoan(0, { value: remaining });

      loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);
      expect(loan.principalRepaid).to.equal(principal);

      // Total interest = 0.01 (full principal, days 0-10) + 0.005 (half principal, days 10-20).
      const totalInterestPaid = loan.amountRepaid - principal;
      const secondInterest = ((principal / 2n) * 3650n * 10n) / (10000n * 365n); // 0.005 ETH
      expect(totalInterestPaid).to.equal(firstInterest + secondInterest); // 0.015 ETH

      // And strictly cheaper than the old original-principal model (which would charge 0.02 ETH).
      const originalPrincipalModel = perDayFull * 20n; // 0.02 ETH
      expect(totalInterestPaid).to.be.lessThan(originalPrincipalModel);
    });

    it('keeps interest identical when no principal is repaid early (drip equals lump)', async function () {
      // Paying only interest along the way leaves the outstanding principal at 100%,
      // so the total interest equals the full-term original-principal amount.
      const { vault, borrower, principal } = await deployFunded(3650, 30n * 86400n);
      const perDayFull = (principal * 3650n) / (10000n * 365n);

      // Day 10: pay exactly the accrued interest (no principal reduction).
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      await vault.connect(borrower).repayLoan(0, { value: perDayFull * 10n });
      const mid = await vault.loans(0);
      expect(mid.principalRepaid).to.equal(0n); // all went to interest

      // Day 20: pay the rest.
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const remaining = (await vault.getRepaymentDetails(0))[5];
      await vault.connect(borrower).repayLoan(0, { value: remaining });

      const loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);
      // Outstanding stayed at full principal the whole time => 20 days on 1 ETH = 0.02 ETH.
      expect(loan.amountRepaid - principal).to.equal(perDayFull * 20n);
    });

    it('charges the minimum-interest floor as an origination fee at funding', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      // 5% floor of principal, charged immediately on funding.
      await expect(vault.connect(owner).setMinInterestBps(500)).to.emit(vault, 'MinInterestUpdated').withArgs(500);

      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      const floor = (principal * 500n) / 10000n; // 0.05 ETH

      // At 0 elapsed days the borrower already owes principal + floor.
      const rd0 = await vault.getRepaymentDetails(0);
      expect(rd0[3]).to.equal(principal + floor);

      // After 10 days the floor stacks on top of time-based interest (on full principal).
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const timeInterest = (principal * 3650n * 10n) / (10000n * 365n); // 0.01 ETH
      const rd1 = await vault.getRepaymentDetails(0);
      expect(rd1[3]).to.equal(principal + floor + timeInterest);
    });

    it('guarantees the lender a floor return when the borrower repays instantly', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      await vault.connect(owner).setMinInterestBps(500); // 5% floor
      // Route the protocol fee away so the lender's receipt is easy to reason about.
      await vault.connect(owner).setProtocolFeeBps(0);

      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      const floor = (principal * 500n) / 10000n; // 0.05 ETH
      const lenderBefore = await ethers.provider.getBalance(lender.address);

      // Repay the whole thing immediately (no time-based interest yet) — still owes the floor.
      await vault.connect(borrower).repayLoan(0, { value: principal + floor });

      const lenderAfter = await ethers.provider.getBalance(lender.address);
      expect(lenderAfter - lenderBefore).to.equal(principal + floor);

      const loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);
      expect(loan.amountRepaid - principal).to.equal(floor); // interest paid == floor
    });

    it('reverts setMinInterestBps above the cap and for non-owners', async function () {
      const [owner, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await expect(vault.connect(owner).setMinInterestBps(10001)).to.be.revertedWith('Min interest exceeds max');
      await expect(vault.connect(borrower).setMinInterestBps(100)).to.be.reverted; // onlyOwner
    });
  });

  describe('cancelLoan', function () {
    async function deployUnfunded() {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('2.0');
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 86400, 7n * 86400n, { value: collateral });
      return { vault, owner, borrower, lender, collateral, principal };
    }

    it('lets the borrower cancel an unfunded loan and returns ETH collateral', async function () {
      const { vault, borrower, collateral } = await deployUnfunded();
      const before = await ethers.provider.getBalance(borrower.address);
      const tx = await vault.connect(borrower).cancelLoan(0);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(borrower.address);
      expect(after).to.equal(before + collateral - gas);

      const loan = await vault.loans(0);
      expect(loan.active).to.equal(false);
      expect(loan.collateralLocked).to.equal(false);
      expect(await vault.lockedBalanceOf(borrower.address)).to.equal(0);
    });

    it('emits LoanCancelled', async function () {
      const { vault, borrower } = await deployUnfunded();
      await expect(vault.connect(borrower).cancelLoan(0))
        .to.emit(vault, 'LoanCancelled')
        .withArgs(0, borrower.address, (t: bigint) => t > 0n);
    });

    it('reverts if a non-borrower tries to cancel', async function () {
      const { vault, lender } = await deployUnfunded();
      await expect(vault.connect(lender).cancelLoan(0)).to.be.revertedWith('Only borrower can cancel');
    });

    it('reverts if the loan is already funded', async function () {
      const { vault, borrower, lender, principal } = await deployUnfunded();
      await vault.connect(lender).fundLoan(0, { value: principal });
      await expect(vault.connect(borrower).cancelLoan(0)).to.be.revertedWith('Cannot cancel a funded loan');
    });

    it('returns ERC20 collateral when the borrower cancels', async function () {
      const [owner, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const totalSupply = ethers.parseUnits('1000', 18);
      const collateral = ethers.parseUnits('50', 18);
      const principal = ethers.parseUnits('100', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      await token.transfer(borrower.address, collateral);
      await token.connect(borrower).approve(await vault.getAddress(), collateral);
      await vault
        .connect(borrower)
        .createLoanWithERC20(
          await token.getAddress(),
          collateral,
          ethers.ZeroAddress,
          principal,
          500,
          86400,
          7n * 86400n,
        );

      const before = await token.balanceOf(borrower.address);
      await vault.connect(borrower).cancelLoan(0);
      const after = await token.balanceOf(borrower.address);

      expect(after - before).to.equal(collateral);
      const loan = await vault.loans(0);
      expect(loan.active).to.equal(false);
      expect(loan.collateralLocked).to.equal(false);
    });
  });

  describe('protocol fee', function () {
    async function deployVault() {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      return { vault, owner, borrower, lender };
    }

    it('initializes with a 10% fee and the owner as treasury', async function () {
      const { vault, owner } = await deployVault();
      expect(await vault.protocolFeeBps()).to.equal(1000);
      expect(await vault.protocolTreasury()).to.equal(owner.address);
    });

    it('lets the owner update the fee within the cap', async function () {
      const { vault } = await deployVault();
      await expect(vault.setProtocolFeeBps(2500)).to.emit(vault, 'ProtocolFeeUpdated').withArgs(2500);
      expect(await vault.protocolFeeBps()).to.equal(2500);
    });

    it('reverts when the fee exceeds the cap', async function () {
      const { vault } = await deployVault();
      const max = await vault.MAX_PROTOCOL_FEE_BPS();
      await expect(vault.setProtocolFeeBps(max + 1n)).to.be.revertedWith('Fee exceeds max');
    });

    it('only the owner can update the fee', async function () {
      const { vault, borrower } = await deployVault();
      await expect(vault.connect(borrower).setProtocolFeeBps(0)).to.be.reverted;
    });

    it('lets the owner update the treasury but rejects the zero address', async function () {
      const { vault, lender } = await deployVault();
      await expect(vault.setProtocolTreasury(lender.address))
        .to.emit(vault, 'ProtocolTreasuryUpdated')
        .withArgs(lender.address);
      expect(await vault.protocolTreasury()).to.equal(lender.address);
      await expect(vault.setProtocolTreasury(ethers.ZeroAddress)).to.be.revertedWith('Treasury cannot be zero address');
    });

    it('only the owner can update the treasury', async function () {
      const { vault, borrower, lender } = await deployVault();
      await expect(vault.connect(borrower).setProtocolTreasury(lender.address)).to.be.reverted;
    });

    it('takes no fee when the rate is set to 0 (lender receives full interest)', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setProtocolFeeBps(0);

      const token = await MockERC20.deploy('Mock', 'MOCK', 18, 0);
      const principal = ethers.parseUnits('100', 18);
      const collateral = ethers.parseEther('1.0');
      const durationSeconds = 30n * 86400n;
      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principal, 1000, durationSeconds, 7n * 86400n, { value: collateral });
      await token.mint(lender.address, principal);
      await token.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principal);

      await ethers.provider.send('evm_increaseTime', [Number(durationSeconds) + 86400]);
      await ethers.provider.send('evm_mine', []);
      const interest = (principal * 1000n * 30n) / (10000n * 365n);
      const totalDue = principal + interest;

      await token.mint(borrower.address, interest);
      await token.connect(borrower).approve(await vault.getAddress(), totalDue);

      const treasuryBefore = await token.balanceOf(owner.address);
      const lenderBefore = await token.balanceOf(lender.address);
      await vault.connect(borrower).repayLoanWithERC20(0, totalDue);

      expect((await token.balanceOf(lender.address)) - lenderBefore).to.equal(totalDue);
      expect((await token.balanceOf(owner.address)) - treasuryBefore).to.equal(0n);
    });
  });

  describe('pull-over-push payouts', function () {
    it('reverts withdrawPayments when nothing is credited', async function () {
      const [owner, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await expect(vault.connect(lender).withdrawPayments(ethers.ZeroAddress)).to.be.revertedWith(
        'Nothing to withdraw',
      );
    });

    it('falls back to a credit when a lender rejects ETH, without blocking repayment', async function () {
      const [owner, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const RejectingLender = await ethers.getContractFactory('RejectingLender');
      const rejecter = await RejectingLender.deploy();
      const rejecterAddr = await rejecter.getAddress();

      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      // Borrower opens an ETH-principal loan, funded by the rejecting contract.
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 30n * 86400n, 7n * 86400n, { value: collateral });
      await rejecter.fund(await vault.getAddress(), 0, { value: principal });

      // No time elapsed → no interest; totalDue == principal.
      // The hybrid payout attempts a direct transfer, which the lender rejects, so it must
      // fall back to a credit instead of reverting the borrower's repayment.
      await expect(vault.connect(borrower).repayLoan(0, { value: principal })).to.not.be.reverted;

      const loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);

      // Payout is safely escrowed for the lender contract to pull later.
      expect(await vault.pendingPayments(rejecterAddr, ethers.ZeroAddress)).to.equal(principal);

      // The rejecting lender still cannot pull ETH (no receive), but the borrower is unaffected.
      await expect(rejecter.claim(await vault.getAddress(), ethers.ZeroAddress)).to.be.reverted;
    });

    it('falls back to a credit when an ERC20 payout fails, and the lender can still claim', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const FailableERC20 = await ethers.getContractFactory('FailableERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const principal = ethers.parseUnits('100', 18);
      const collateral = ethers.parseEther('1.0');
      const token = await FailableERC20.deploy();
      const tokenAddr = await token.getAddress();

      await vault
        .connect(borrower)
        .createLoan(tokenAddr, principal, 0, 30n * 86400n, 7n * 86400n, { value: collateral });

      await token.mint(lender.address, principal);
      await token.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, tokenAddr, principal);

      // Make the token reject `transfer` so the direct payout to the lender fails and the
      // vault must fall back to a credit. `transferFrom` (the vault pulling funds in) still works.
      await token.setFailTransfers(true);
      await token.connect(borrower).approve(await vault.getAddress(), principal);
      await vault.connect(borrower).repayLoanWithERC20(0, principal);

      // Repayment still succeeded; the payout is escrowed in the vault for the lender.
      const loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);
      expect(await vault.pendingPayments(lender.address, tokenAddr)).to.equal(principal);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(principal);

      // Re-enable transfers and let the lender pull their funds.
      await token.setFailTransfers(false);
      const before = await token.balanceOf(lender.address);
      await expect(vault.connect(lender).withdrawPayments(tokenAddr))
        .to.emit(vault, 'PaymentWithdrawn')
        .withArgs(lender.address, tokenAddr, principal);
      expect((await token.balanceOf(lender.address)) - before).to.equal(principal);
      expect(await vault.pendingPayments(lender.address, tokenAddr)).to.equal(0n);
    });
  });
});
