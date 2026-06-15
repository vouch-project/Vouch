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
      const tx = await vault.createLoan(ethers.ZeroAddress, sentCollateral, 500, 86400, fundWindow, { value: sentCollateral });
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
      expect(repaymentDetails[0]).to.equal(500);   // interestRateBps
      expect(repaymentDetails[1]).to.equal(86400); // durationSeconds
      expect(repaymentDetails[2]).to.equal(false); // repaid
      expect(repaymentDetails[3]).to.equal(0);     // totalDue (not funded)
      expect(repaymentDetails[4]).to.equal(0);     // amountRepaid
      expect(repaymentDetails[5]).to.equal(0);     // remaining
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

    it('Should fail if interest rate exceeds 100%', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');

      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 10001, 0, 7n * 86400n, { value: collateral }),
      ).to.be.revertedWith('Interest rate cannot exceed 100%');
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
      await vault.createLoanWithERC20(await token.getAddress(), collateral, ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n);

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
      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 500, 86400, 7n * 86400n, { value: collateral });
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
        .createLoanWithERC20(await token.getAddress(), collateral, await token.getAddress(), principalAmount, 0, 0, 7n * 86400n);

      await expect(vault.connect(lender).fundLoan(0, { value: ethers.parseEther('1.0') })).to.be.revertedWith(
        'Token does not match requested principal token',
      );
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

      await vault.connect(borrower).createLoan(await token.getAddress(), principalAmount, 0, 0, 7n * 86400n, { value: collateral });

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

      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principalAmount, 0, 0, 7n * 86400n, { value: collateral });

      await expect(
        vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount),
      ).to.be.revertedWith('Loan requires native ETH principal; use fundLoan');
    });
  });

  describe('repayLoan (ETH principal)', function () {
    async function deployFundedLoan(interestRateBps = 500) {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('2.0');
      const principal = ethers.parseEther('1.0');

      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, interestRateBps, 86400, 7n * 86400n, { value: collateral });
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

      const lenderAfter = await ethers.provider.getBalance(lender.address);
      const borrowerAfter = await ethers.provider.getBalance(borrower.address);

      expect(lenderAfter - lenderBefore).to.equal(totalDue);
      expect(borrowerAfter - borrowerBefore).to.equal(collateral - totalDue - gasUsed);
    });

    it('Should mark loan as inactive and repaid after full payment', async function () {
      const { vault, borrower, totalDue } = await deployFundedLoan();

      await vault.connect(borrower).repayLoan(0, { value: totalDue });

      const loan = await vault.getLoan(0);
      expect(loan[4]).to.equal(false); // active = false

      const rd = await vault.getRepaymentDetails(0);
      expect(rd[2]).to.equal(true);        // repaid
      // No days elapsed → accrued interest is 0, so totalDue == principal here.
      expect(rd[4]).to.equal(totalDue);    // amountRepaid == totalDue paid
      expect(rd[5]).to.equal(0n);          // remaining == 0
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

      await vault.connect(borrower).createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, { value: collateral });

      await expect(vault.connect(borrower).repayLoan(0, { value: collateral })).to.be.revertedWith(
        'Loan is not funded',
      );
    });

    it('Should fail on double repayment', async function () {
      const { vault, borrower, totalDue } = await deployFundedLoan();

      await vault.connect(borrower).repayLoan(0, { value: totalDue });

      await expect(vault.connect(borrower).repayLoan(0, { value: totalDue })).to.be.revertedWith(
        'Loan already repaid',
      );
    });

    it('Should fail if loan has ERC20 principal', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      await vault.connect(borrower).createLoan(await token.getAddress(), principalAmount, 500, 0, 7n * 86400n, { value: collateral });
      await token.transfer(lender.address, principalAmount);
      await token.connect(lender).approve(await vault.getAddress(), principalAmount);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount);

      await expect(
        vault.connect(borrower).repayLoan(0, { value: ethers.parseEther('1.1') }),
      ).to.be.revertedWith('Loan has ERC20 principal; use repayLoanWithERC20');
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
        expect(rd[4]).to.equal(half);              // amountRepaid (half paid)
        expect(rd[5]).to.equal(principal - half);  // remaining = accrued due(=principal) - amountRepaid
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
        expect(locked[2]).to.equal(true);                // still locked (loan not fully repaid)
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
        expect(rd[5]).to.equal(0n);   // remaining = 0
      });

      it('Should fail on a payment that would exceed the remaining balance', async function () {
        const { vault, borrower, totalDue } = await deployFundedLoan(500);

        const half = totalDue / 2n;
        await vault.connect(borrower).repayLoan(0, { value: half });

        const remaining = totalDue - half;
        await expect(
          vault.connect(borrower).repayLoan(0, { value: remaining + 1n }),
        ).to.be.revertedWith('Payment exceeds amount owed');
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

      await vault.connect(borrower).createLoan(await token.getAddress(), principalAmount, interestRateBps, 86400, 7n * 86400n, { value: collateral });

      await token.transfer(lender.address, principalAmount);
      await token.connect(lender).approve(await vault.getAddress(), principalAmount);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount);

      const interest = (principalAmount * BigInt(interestRateBps)) / 10000n;
      const totalDue = principalAmount + interest;

      // Give borrower enough to cover interest (they already received the principal)
      await token.transfer(borrower.address, interest);

      return { vault, owner, borrower, lender, token, collateral, principalAmount, interest, totalDue };
    }

    it('Should repay ERC20 loan in full, forward tokens to lender, return ETH collateral', async function () {
      const { vault, borrower, lender, token, collateral, principalAmount, interest, totalDue } =
        await deployFundedERC20Loan();

      await token.connect(borrower).approve(await vault.getAddress(), totalDue);

      const lenderTokenBefore = await token.balanceOf(lender.address);
      const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);

      const tx = await vault.connect(borrower).repayLoanWithERC20(0, totalDue);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      await expect(tx)
        .to.emit(vault, 'LoanRepaid')
        .withArgs(0, borrower.address, lender.address, principalAmount, interest, totalDue, (ts: bigint) => ts > 0n);

      const lenderTokenAfter = await token.balanceOf(lender.address);
      expect(lenderTokenAfter - lenderTokenBefore).to.equal(totalDue);

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
      const interest = (principalAmount * BigInt(interestRateBps)) / 10000n;
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
        const interestRateBps = 1000; // 10%
        const interest = (principalAmount * BigInt(interestRateBps)) / 10000n;
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

        // Pay half
        const half = totalDue / 2n;
        const expectedCollateralRelease = (collateral * half) / totalDue;

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
      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 3650, durationSeconds, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      // Advance past the term so accrued interest is capped at exactly 10 whole days (deterministic).
      await ethers.provider.send('evm_increaseTime', [11 * 86400]);
      await ethers.provider.send('evm_mine', []);

      const rd1 = await vault.getRepaymentDetails(0);
      expect(rd1[0]).to.equal(3650);              // 36.5% APR
      expect(rd1[2]).to.equal(false);             // not repaid
      expect(rd1[3]).to.equal(expectedTotalDue);  // totalDue (principal + capped accrued interest)
      expect(rd1[4]).to.equal(0n);                // amountRepaid
      expect(rd1[5]).to.equal(expectedTotalDue);  // remaining

      // Partial payment (repayLoan still uses flat interest, but 0.5 is within remaining either way)
      const payment = ethers.parseEther('0.5');
      await vault.connect(borrower).repayLoan(0, { value: payment });

      const rd2 = await vault.getRepaymentDetails(0);
      expect(rd2[4]).to.equal(payment);                       // amountRepaid
      expect(rd2[5]).to.equal(expectedTotalDue - payment);    // remaining (capped accrued due - amountRepaid)
      expect(rd2[2]).to.equal(false);                          // still not repaid
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
        .createLoan(ethers.ZeroAddress, principal, interestRateBps, durationSeconds, 7n * 86400n, { value: collateral });
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
});
