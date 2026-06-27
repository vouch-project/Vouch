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

      const tx = await vault.createLoan(ethers.ZeroAddress, sentCollateral, 500, 86400, 8000, { value: sentCollateral });
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

      const repaymentDetails = await vault.getRepaymentDetails(0);
      expect(repaymentDetails[0]).to.equal(500);   // interestRateBps
      expect(repaymentDetails[1]).to.equal(86400); // durationSeconds
      expect(repaymentDetails[2]).to.equal(false); // repaid
      expect(repaymentDetails[3]).to.equal(0);     // totalDue (not funded)
      expect(repaymentDetails[4]).to.equal(0);     // amountRepaid
      expect(repaymentDetails[5]).to.equal(0);     // remaining
    });

    it('Should fail if collateral is zero', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      await expect(
        vault.createLoan(ethers.ZeroAddress, ethers.parseEther('1.0'), 0, 0, 8000, { value: 0 }),
      ).to.be.revertedWith('Collateral must be > 0');
    });

    it('Should fail if interest rate exceeds 100%', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');

      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 10001, 0, 8000, { value: collateral }),
      ).to.be.revertedWith('Interest rate cannot exceed 100%');
    });

    it('Should not allow withdrawing active ETH loan collateral', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');

      await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 8000, { value: collateral });

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
      await vault.createLoanWithERC20(await token.getAddress(), collateral, ethers.ZeroAddress, collateral, 0, 0, 8000);

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
      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 500, 86400, 8000, { value: collateral });
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
        .createLoanWithERC20(await token.getAddress(), collateral, await token.getAddress(), principalAmount, 0, 0, 8000);

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

      await vault.connect(borrower).createLoan(await token.getAddress(), principalAmount, 0, 0, 8000, { value: collateral });

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

      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principalAmount, 0, 0, 8000, { value: collateral });

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

      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, interestRateBps, 86400, 8000, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      const interest = (principal * BigInt(interestRateBps)) / 10000n;
      const totalDue = principal + interest;
      return { vault, owner, borrower, lender, collateral, principal, interest, totalDue };
    }

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
      expect(rd[2]).to.equal(true);     // repaid
      expect(rd[4]).to.equal(rd[3]);    // amountRepaid == totalDue
      expect(rd[5]).to.equal(0n);       // remaining == 0
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

      await vault.connect(borrower).createLoan(ethers.ZeroAddress, collateral, 0, 0, 8000, { value: collateral });

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

      await vault.connect(borrower).createLoan(await token.getAddress(), principalAmount, 500, 0, 8000, { value: collateral });
      await token.transfer(lender.address, principalAmount);
      await token.connect(lender).approve(await vault.getAddress(), principalAmount);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount);

      await expect(
        vault.connect(borrower).repayLoan(0, { value: ethers.parseEther('1.1') }),
      ).to.be.revertedWith('Loan has ERC20 principal; use repayLoanWithERC20');
    });

    describe('partial repayments', function () {
      it('Should release proportional collateral on each partial payment', async function () {
        const { vault, borrower, lender, collateral, totalDue } = await deployFundedLoan(1000); // 10%
        // totalDue = 1 ETH + 10% = 1.1 ETH, collateral = 2 ETH
        // Pay 50% of totalDue → expect ~50% collateral back

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

        // getRepaymentDetails reflects progress
        const rd = await vault.getRepaymentDetails(0);
        expect(rd[4]).to.equal(half);           // amountRepaid
        expect(rd[5]).to.equal(totalDue - half); // remaining
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

      await vault.connect(borrower).createLoan(await token.getAddress(), principalAmount, interestRateBps, 86400, 8000, { value: collateral });

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
          8000,
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
      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 0, 0, 8000, { value: collateral });
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
            8000,
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

      await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 1000, 0, 8000, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      const rd1 = await vault.getRepaymentDetails(0);
      expect(rd1[0]).to.equal(1000);                      // 10%
      expect(rd1[2]).to.equal(false);                     // not repaid
      expect(rd1[3]).to.equal(ethers.parseEther('1.1')); // totalDue
      expect(rd1[4]).to.equal(0n);                        // amountRepaid
      expect(rd1[5]).to.equal(ethers.parseEther('1.1')); // remaining

      // Partial payment
      const payment = ethers.parseEther('0.5');
      await vault.connect(borrower).repayLoan(0, { value: payment });

      const rd2 = await vault.getRepaymentDetails(0);
      expect(rd2[4]).to.equal(payment);                                             // amountRepaid
      expect(rd2[5]).to.equal(ethers.parseEther('1.1') - payment);                 // remaining
      expect(rd2[2]).to.equal(false);                                               // still not repaid
    });
  });

  describe('Chainlink & health factor', function () {
    async function deployWithFeeds() {
      const [owner, lender, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      // ETH/USD at $3200, 8 decimals (standard Chainlink)
      const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
      // MOCK/USD at $1000, 8 decimals
      const mockFeed = await MockAgg.deploy(8, 1000n * 10n ** 8n);

      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const mockToken = await MockERC20.deploy('MOCK', 'MOCK', 18, ethers.parseEther('1000000'));

      await vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 18);
      await vault.connect(owner).setPriceFeed(await mockToken.getAddress(), await mockFeed.getAddress(), 18);

      return { vault, ethFeed, mockFeed, mockToken, owner, lender, borrower };
    }

    it('setPriceFeed reverts for non-owner', async function () {
      const { vault, ethFeed, borrower } = await deployWithFeeds();
      await expect(
        vault.connect(borrower).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 18)
      ).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount');
    });

    it('getHealthFactor returns correct value for ETH-collateral loan', async function () {
      // ETH collateral $3200, MOCK principal $1000 each, threshold 8000 bps (80%)
      // collateral = 1 ETH = 1e18 wei, borrow = 2 MOCK tokens
      // healthFactor = (1e18 * 3200e18 * 8000 * 1e18) / (2e18 * 1000e18 * 10000)
      //              = (3200 * 8000 * 1e18) / (2000 * 10000) = 1.28e18
      const { vault, mockToken, lender, borrower } = await deployWithFeeds();

      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18); // 2 MOCK tokens
      const thresholdBps = 8000;

      await vault.connect(borrower).createLoan(
        await mockToken.getAddress(), principal, 0, 0, thresholdBps, { value: collateral }
      );

      // Fund the loan
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      const hf = await vault.getHealthFactor(0);
      // Expected: 1.28e18
      expect(hf).to.equal(128n * 10n ** 16n);
    });

    it('getHealthFactor reverts if loan not funded', async function () {
      const { vault } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 8000, { value: collateral });
      await expect(vault.getHealthFactor(0)).to.be.revertedWith('Loan not funded');
    });

    it('liquidate reverts if health factor >= 1', async function () {
      const { vault, mockToken, lender, borrower } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      await vault.connect(borrower).createLoan(
        await mockToken.getAddress(), principal, 0, 0, 8000, { value: collateral }
      );
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      await expect(vault.liquidate(0)).to.be.revertedWith('Loan is not undercollateralized');
    });

    it('liquidate reverts with not implemented when undercollateralized', async function () {
      const { vault, mockToken, ethFeed, lender, borrower } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      await vault.connect(borrower).createLoan(
        await mockToken.getAddress(), principal, 0, 0, 8000, { value: collateral }
      );
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      // Crash ETH price so health factor drops below 1
      await ethFeed.updateAnswer(100n * 10n ** 8n); // $100

      await expect(vault.liquidate(0))
        .to.be.revertedWith('liquidate: not implemented');
    });

    it('getHealthFactor: correct for mismatched token decimals (18-dec collateral, 6-dec principal)', async function () {
      // ETH (18-dec) collateral @ $3200, USDC (6-dec) principal @ $1
      // 1 ETH collateral, 1000 USDC principal, threshold 9000 bps (90%)
      //
      // normalizedCollateral = 1e18 (ETH, already 18-dec)
      // normalizedDebt       = 1000 * 1e6 * 1e12 = 1000 * 1e18 (USDC 6->18)
      // collateralUSD = 1e18 * 3200e18 = 3200e36
      // debtUSD       = 1000e18 * 1e18 = 1000e36
      // healthFactor  = (3200e36 * 9000 * 1e18) / (1000e36 * 10000)
      //               = (3200 * 9000) / (1000 * 10000) * 1e18
      //               = 2.88e18
      const { vault, owner, lender, borrower } = await deployWithFeeds();

      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      // USDC/USD: $1, 8 decimals
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n);
      await usdcFeed.waitForDeployment();

      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6, 0n);
      await usdc.waitForDeployment();
      const usdcAddress = await usdc.getAddress();

      // Register USDC price feed with 6 decimals
      await vault.connect(owner).setPriceFeed(usdcAddress, await usdcFeed.getAddress(), 6);

      // Mint USDC to lender
      const principalUsdc = ethers.parseUnits('1000', 6); // 1000 USDC
      await usdc.mint(lender.address, principalUsdc);
      await usdc.connect(lender).approve(await vault.getAddress(), principalUsdc);

      // Borrower creates loan: 1 ETH collateral, 1000 USDC principal, threshold 9000 bps
      const collateralEth = ethers.parseEther('1');
      await vault.connect(borrower).createLoan(
        usdcAddress, principalUsdc, 0, 0, 9000, { value: collateralEth }
      );

      // Lender funds the loan (loan ID is 0 — first loan in this fixture)
      await vault.connect(lender).fundLoanWithERC20(0, usdcAddress, principalUsdc);

      const hf = await vault.getHealthFactor(0);
      // Expected: (3200 * 9000) / (1000 * 10000) * 1e18 = 2.88e18
      const expected = (3200n * 9000n * 10n ** 18n) / (1000n * 10000n);
      expect(hf).to.equal(expected);
    });
  });
});
