import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';

describe('VouchVault', function () {
  async function signLtvAttestation(
    vault: any,
    signer: any,
    borrowerAddress: string,
    maxLtvBps: number,
    collateralToken: string = ethers.ZeroAddress,
    borrowToken: string = ethers.ZeroAddress,
    overrideExpiry?: bigint,
  ): Promise<{ expiry: bigint; sig: string }> {
    const network = await ethers.provider.getNetwork();
    const vaultAddress = await vault.getAddress();
    const nonce = await vault.nonces(borrowerAddress);
    const expiry = overrideExpiry ?? 9999999999n;
    const domain = {
      name: 'VouchVault',
      version: '1',
      chainId: Number(network.chainId),
      verifyingContract: vaultAddress,
    };
    const types = {
      LtvAttestation: [
        { name: 'borrower', type: 'address' },
        { name: 'collateralToken', type: 'address' },
        { name: 'borrowToken', type: 'address' },
        { name: 'maxLtvBps', type: 'uint16' },
        { name: 'expiry', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    };
    const value = { borrower: borrowerAddress, collateralToken, borrowToken, maxLtvBps, expiry, nonce };
    const sig = await signer.signTypedData(domain, types, value);
    return { expiry, sig };
  }

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
      await vault.setScoreSigner(owner.address);
      const sentCollateral = ethers.parseEther('1.0');

      const fundWindow = 7n * 86400n; // 7 days
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, owner.address, 10000);
      const tx = await vault.createLoan(
        ethers.ZeroAddress,
        sentCollateral,
        500,
        86400,
        fundWindow,
        8000,
        10000,
        ltvExpiry,
        ltvSig,
        {
          value: sentCollateral,
        },
      );
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
      await vault.setScoreSigner(owner.address);

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, owner.address, 10000);
      await expect(
        vault.createLoan(
          ethers.ZeroAddress,
          ethers.parseEther('1.0'),
          0,
          0,
          7n * 86400n,
          8000,
          10000,
          ltvExpiry,
          ltvSig,
          { value: 0 },
        ),
      ).to.be.revertedWith('Collateral must be > 0');
    });

    it('Should fail if fund window is zero', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, owner.address, 10000);
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 0, 86400, 0, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        }),
      ).to.be.revertedWith('Fund window must be > 0');
    });

    it('reverts when the interest rate exceeds 100% (10000 bps cap)', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');
      // Above the cap (10001 bps = 100.01% APR) is rejected.
      const { expiry: ltvExpiry1, sig: ltvSig1 } = await signLtvAttestation(vault, owner, owner.address, 10000);
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 10001, 86400, 7n * 86400n, 8000, 10000, ltvExpiry1, ltvSig1, {
          value: collateral,
        }),
      ).to.be.revertedWith('Interest rate cannot exceed 100%');
      // Exactly at the cap (10000 bps = 100% APR) is accepted.
      const { expiry: ltvExpiry2, sig: ltvSig2 } = await signLtvAttestation(vault, owner, owner.address, 10000);
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 10000, 86400, 7n * 86400n, 8000, 10000, ltvExpiry2, ltvSig2, {
          value: collateral,
        }),
      ).to.not.be.reverted;
      const loan = await vault.loans(0);
      expect(loan.interestRateBps).to.equal(10000n);
    });

    it('Should not allow withdrawing active ETH loan collateral', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, owner.address, 10000);
      await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
        value: collateral,
      });

      await expect(vault.withdraw(collateral)).to.be.revertedWith('Insufficient balance');
    });

    it('Should lock ERC20 collateral per loan', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');

      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);

      const totalSupply = ethers.parseUnits('1000', 18);
      const collateral = ethers.parseUnits('50', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      await token.approve(await vault.getAddress(), collateral);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        owner.address,
        10000,
        await token.getAddress(),
        ethers.ZeroAddress,
      );
      await vault.createLoanWithERC20(
        await token.getAddress(),
        collateral,
        ethers.ZeroAddress,
        collateral,
        0,
        0,
        7n * 86400n,
        8000,
        10000,
        ltvExpiry,
        ltvSig,
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

    it('reverts when LTV attestation is expired', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');
      const latestBlock = await ethers.provider.getBlock('latest');
      const pastExpiry = BigInt(latestBlock!.timestamp - 1);
      const { sig } = await signLtvAttestation(
        vault,
        owner,
        owner.address,
        10000,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        pastExpiry,
      );
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, pastExpiry, sig, {
          value: collateral,
        }),
      ).to.be.revertedWith('Attestation expired');
    });

    it('reverts when LTV attestation has an invalid signature', async function () {
      const [owner, attacker] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');
      // Sign with attacker instead of owner (the configured scoreSigner).
      const { expiry, sig } = await signLtvAttestation(vault, attacker, owner.address, 10000);
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, expiry, sig, {
          value: collateral,
        }),
      ).to.be.revertedWith('Invalid attestation');
    });

    it('reverts when liquidationThresholdBps exceeds maxLtvBps', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');
      const { expiry, sig } = await signLtvAttestation(vault, owner, owner.address, 7000);
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 7000, expiry, sig, {
          value: collateral,
        }),
      ).to.be.revertedWith('Exceeds attested LTV');
    });

    it('reverts on nonce replay after a successful createLoan', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');
      const { expiry, sig } = await signLtvAttestation(vault, owner, owner.address, 10000);
      // First use succeeds and increments the nonce.
      await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, expiry, sig, {
        value: collateral,
      });
      // Replaying the same sig now fails because the nonce changed.
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, expiry, sig, {
          value: collateral,
        }),
      ).to.be.revertedWith('Invalid attestation');
    });

    it('reverts when attestation is signed for different tokens than the loan', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseUnits('50', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      await token.approve(await vault.getAddress(), collateral);
      // Sign attestation claiming ZeroAddress as collateral token (like an ETH loan).
      const { expiry, sig } = await signLtvAttestation(
        vault,
        owner,
        owner.address,
        10000,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      );
      // But try to use it for an ERC20 collateral loan — should fail.
      await expect(
        vault.createLoanWithERC20(
          await token.getAddress(),
          collateral,
          ethers.ZeroAddress,
          collateral,
          0,
          0,
          7n * 86400n,
          8000,
          10000,
          expiry,
          sig,
        ),
      ).to.be.revertedWith('Invalid attestation');
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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('0.5');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 86400, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      await token.transfer(borrower.address, collateral);
      await token.connect(borrower).approve(await vault.getAddress(), collateral);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        await token.getAddress(),
        await token.getAddress(),
      );
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
          8000,
          10000,
          ltvExpiry,
          ltvSig,
        );

      await expect(vault.connect(lender).fundLoan(0, { value: ethers.parseEther('1.0') })).to.be.revertedWith(
        'Token does not match requested principal token',
      );
    });

    it('reverts when funding after the fund window has passed', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('2.0');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 86400, 3n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        }); // 3-day window
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
      await vault.setScoreSigner(owner.address);

      const totalSupply = ethers.parseUnits('1000', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await token.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principalAmount, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });

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
      await vault.setScoreSigner(owner.address);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseEther('1.0');

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principalAmount, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });

      await expect(
        vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principalAmount),
      ).to.be.revertedWith('Loan requires native ETH principal; use fundLoan');
    });

    it('reverts when funding after the fund window has passed', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);

      const totalSupply = ethers.parseUnits('1000', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await token.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principalAmount, 0, 0, 3n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        }); // 3-day window

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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('2.0');
      const principal = ethers.parseEther('1.0');

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(
          ethers.ZeroAddress,
          principal,
          interestRateBps,
          86400,
          7n * 86400n,
          8000,
          10000,
          ltvExpiry,
          ltvSig,
          { value: collateral },
        );
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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });

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
      await vault.setScoreSigner(owner.address);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('1000', 18));
      const collateral = ethers.parseEther('0.5');
      const principalAmount = ethers.parseUnits('100', 18);

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await token.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principalAmount, 500, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
        await vault.setScoreSigner(owner.address);

        const principal = ethers.parseEther('1.0');
        const collateral = ethers.parseEther('5.0');
        const interestRateBps = 3650n; // 36.5% APR
        const durationDays = 30n;
        const elapsedDays = 10n;

        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
        await vault
          .connect(borrower)
          .createLoan(
            ethers.ZeroAddress,
            principal,
            Number(interestRateBps),
            durationDays * 86400n,
            7n * 86400n,
            8000,
            10000,
            ltvExpiry,
            ltvSig,
            {
              value: collateral,
            },
          );
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
        await vault.setScoreSigner(owner.address);

        const principal = ethers.parseEther('1.0');
        const collateral = ethers.parseEther('5.0');
        const interestRateBps = 3650n; // 36.5% APR

        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
        await vault
          .connect(borrower)
          .createLoan(
            ethers.ZeroAddress,
            principal,
            Number(interestRateBps),
            60n * 86400n,
            7n * 86400n,
            8000,
            10000,
            ltvExpiry,
            ltvSig,
            {
              value: collateral,
            },
          );
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
      await vault.setScoreSigner(owner.address);

      const token = await MockERC20.deploy('Mock', 'MOCK', 18, ethers.parseUnits('10000', 18));
      const collateral = ethers.parseEther('1.0');
      const principalAmount = ethers.parseUnits('100', 18);
      // Interest is now per-day simple interest capped at durationSeconds. Use a 30-day duration
      // so a single fixed amount of interest accrues once the cap is reached (see below).
      const durationSeconds = 30n * 86400n;

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await token.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(
          await token.getAddress(),
          principalAmount,
          interestRateBps,
          durationSeconds,
          7n * 86400n,
          8000,
          10000,
          ltvExpiry,
          ltvSig,
          {
            value: collateral,
          },
        );

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
      await vault.setScoreSigner(owner.address);

      const collateralToken = await MockERC20.deploy('Collateral', 'COL', 18, ethers.parseUnits('10000', 18));
      const principalToken = await MockERC20.deploy('Principal', 'PRI', 18, ethers.parseUnits('10000', 18));

      const collateral = ethers.parseUnits('200', 18);
      const principalAmount = ethers.parseUnits('100', 18);
      const interestRateBps = 500;
      const durationSeconds = 30n * 86400n;

      await collateralToken.transfer(borrower.address, collateral);
      await collateralToken.connect(borrower).approve(await vault.getAddress(), collateral);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        await collateralToken.getAddress(),
        await principalToken.getAddress(),
      );
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
          8000,
          10000,
          ltvExpiry,
          ltvSig,
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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1.0');
      const principal = ethers.parseEther('0.5');

      const [, , lender] = await ethers.getSigners();
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);
      const Token = await ethers.getContractFactory('MockERC20');
      const token = await Token.deploy('Mock', 'MOCK', 18, 0);
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await token.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(
          await token.getAddress(),
          principal,
          3650,
          30n * 86400n,
          7n * 86400n,
          8000,
          10000,
          ltvExpiry,
          ltvSig,
          { value: collateral },
        );
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
        await vault.setScoreSigner(owner.address);

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
        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
          vault,
          owner,
          borrower.address,
          10000,
          await collateralToken.getAddress(),
          await principalToken.getAddress(),
        );
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
            8000,
            10000,
            ltvExpiry,
            ltvSig,
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
        await vault.setScoreSigner(owner.address);

        const token = await MockERC20.deploy('Mock', 'MOCK', 18, 0);
        const principal = ethers.parseEther('1.0');
        const collateral = ethers.parseEther('5.0');
        const interestRateBps = 3650n; // 36.5% APR

        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
          vault,
          owner,
          borrower.address,
          10000,
          ethers.ZeroAddress,
          await token.getAddress(),
        );
        await vault
          .connect(borrower)
          .createLoan(
            await token.getAddress(),
            principal,
            Number(interestRateBps),
            60n * 86400n,
            7n * 86400n,
            8000,
            10000,
            ltvExpiry,
            ltvSig,
            {
              value: collateral,
            },
          );
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
      await vault.setScoreSigner(owner.address);
      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      // 3650 bps APR over a 10-day term => interest = 1.0 * 3650 * 10 / (10000*365) = 0.01 ETH,
      // so once the full term has accrued (and is capped at it) totalDue == 1.01 ETH.
      const durationSeconds = 10n * 86400n;
      const expectedTotalDue = principal + (principal * 3650n * 10n) / (10000n * 365n);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, durationSeconds, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(
          ethers.ZeroAddress,
          principal,
          interestRateBps,
          durationSeconds,
          7n * 86400n,
          8000,
          10000,
          ltvExpiry,
          ltvSig,
          {
            value: collateral,
          },
        );
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
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(
          ethers.ZeroAddress,
          principal,
          interestRateBps,
          durationSeconds,
          7n * 86400n,
          8000,
          10000,
          ltvExpiry,
          ltvSig,
          {
            value: collateral,
          },
        );
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
      await vault.setScoreSigner(owner.address);
      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      // 5% floor of principal, charged immediately on funding.
      await expect(vault.connect(owner).setMinInterestBps(500)).to.emit(vault, 'MinInterestUpdated').withArgs(500);

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);
      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      await vault.connect(owner).setMinInterestBps(500); // 5% floor
      // Route the protocol fee away so the lender's receipt is easy to reason about.
      await vault.connect(owner).setProtocolFeeBps(0);

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);
      await expect(vault.connect(owner).setMinInterestBps(10001)).to.be.revertedWith('Min interest exceeds max');
      await expect(vault.connect(borrower).setMinInterestBps(100)).to.be.reverted; // onlyOwner
    });
  });

  describe('cancelLoan', function () {
    async function deployUnfunded() {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('2.0');
      const principal = ethers.parseEther('1.0');
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 86400, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);

      const totalSupply = ethers.parseUnits('1000', 18);
      const collateral = ethers.parseUnits('50', 18);
      const principal = ethers.parseUnits('100', 18);
      const token = await MockERC20.deploy('Mock', 'MOCK', 18, totalSupply);

      await token.transfer(borrower.address, collateral);
      await token.connect(borrower).approve(await vault.getAddress(), collateral);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        await token.getAddress(),
        ethers.ZeroAddress,
      );
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
          8000,
          10000,
          ltvExpiry,
          ltvSig,
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
      await vault.setScoreSigner(owner.address);
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
      await vault.setScoreSigner(owner.address);
      await vault.setProtocolFeeBps(0);

      const token = await MockERC20.deploy('Mock', 'MOCK', 18, 0);
      const principal = ethers.parseUnits('100', 18);
      const collateral = ethers.parseEther('1.0');
      const durationSeconds = 30n * 86400n;
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await token.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(
          await token.getAddress(),
          principal,
          1000,
          durationSeconds,
          7n * 86400n,
          8000,
          10000,
          ltvExpiry,
          ltvSig,
          {
            value: collateral,
          },
        );
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
      await vault.setScoreSigner(owner.address);
      await expect(vault.connect(lender).withdrawPayments(ethers.ZeroAddress)).to.be.revertedWith(
        'Nothing to withdraw',
      );
    });

    it('falls back to a credit when a lender rejects ETH, without blocking repayment', async function () {
      const [owner, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);

      const RejectingLender = await ethers.getContractFactory('RejectingLender');
      const rejecter = await RejectingLender.deploy();
      const rejecterAddr = await rejecter.getAddress();

      const principal = ethers.parseEther('1.0');
      const collateral = ethers.parseEther('2.0');

      // Borrower opens an ETH-principal loan, funded by the rejecting contract.
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 500, 30n * 86400n, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
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
      await vault.setScoreSigner(owner.address);

      const principal = ethers.parseUnits('100', 18);
      const collateral = ethers.parseEther('1.0');
      const token = await FailableERC20.deploy();
      const tokenAddr = await token.getAddress();

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        tokenAddr,
      );
      await vault
        .connect(borrower)
        .createLoan(tokenAddr, principal, 0, 30n * 86400n, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });

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

  describe('expireLoan', function () {
    async function deployForExpiry() {
      const [owner, borrower, anyone] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const collateral = ethers.parseEther('1');
      const fundWindow = 3n * 86400n; // 3 days
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, collateral, 0, 0, fundWindow, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      return { vault, borrower, anyone, collateral, fundWindow };
    }

    it('reverts if loan is still within fund window and no price feeds set', async function () {
      const { vault } = await deployForExpiry();
      await expect(vault.expireLoan(0)).to.be.revertedWith('Loan cannot be expired yet');
    });

    it('reverts if loan is already funded', async function () {
      const { vault, collateral } = await deployForExpiry();
      // Fund it first (within window)
      await vault.fundLoan(0, { value: collateral });
      // Advance past window
      await ethers.provider.send('evm_increaseTime', [4 * 86400]);
      await ethers.provider.send('evm_mine', []);
      await expect(vault.expireLoan(0)).to.be.revertedWith('Loan already funded');
    });

    it('returns collateral to borrower and emits LoanExpired when deadline passed', async function () {
      const { vault, borrower, anyone, collateral } = await deployForExpiry();
      await ethers.provider.send('evm_increaseTime', [4 * 86400]);
      await ethers.provider.send('evm_mine', []);

      const balanceBefore = await ethers.provider.getBalance(borrower.address);
      const tx = await vault.connect(anyone).expireLoan(0);
      await expect(tx)
        .to.emit(vault, 'LoanExpired')
        .withArgs(0, borrower.address, (ts: bigint) => ts > 0n);

      const balanceAfter = await ethers.provider.getBalance(borrower.address);
      expect(balanceAfter - balanceBefore).to.equal(collateral);

      const loan = await vault.loans(0);
      expect(loan.active).to.equal(false);
      expect(loan.collateralLocked).to.equal(false);
      expect(loan.collateralReleased).to.equal(collateral);
    });

    it('is permissionless — anyone can expire past-deadline loans', async function () {
      const { vault, anyone } = await deployForExpiry();
      await ethers.provider.send('evm_increaseTime', [4 * 86400]);
      await ethers.provider.send('evm_mine', []);
      await expect(vault.connect(anyone).expireLoan(0)).to.not.be.reverted;
    });

    it('reverts if loan is already expired (inactive)', async function () {
      const { vault } = await deployForExpiry();
      await ethers.provider.send('evm_increaseTime', [4 * 86400]);
      await ethers.provider.send('evm_mine', []);
      await vault.expireLoan(0);
      await expect(vault.expireLoan(0)).to.be.revertedWith('Loan is not active');
    });

    async function deployForExpiryWithFeeds() {
      const [owner, borrower, anyone] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      // ETH/USD at $3200, 8 decimals (standard Chainlink)
      const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const mockToken = await MockERC20.deploy('MOCK', 'MCK', 18, ethers.parseEther('1000000'));
      // MOCK/USD at $1000, 8 decimals
      const mockFeed = await MockAgg.deploy(8, 1000n * 10n ** 8n);
      await vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 18);
      await vault.connect(owner).setPriceFeed(await mockToken.getAddress(), await mockFeed.getAddress(), 18);
      return { vault, mockToken, owner, borrower, anyone };
    }

    it('can be expired within deadline when undercollateralized (price feeds set)', async function () {
      // HF = (0.001 ETH * $3200 * 80%) / (2 MOCK * $1000) = $2.56 / $2000 = 0.00128 — deeply unhealthy
      const { vault, mockToken, owner, borrower, anyone } = await deployForExpiryWithFeeds();
      const collateral = ethers.parseEther('0.001');
      const principal = ethers.parseUnits('2', 18);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });

      const balanceBefore = await ethers.provider.getBalance(borrower.address);
      const tx = await vault.connect(anyone).expireLoan(0);
      await expect(tx)
        .to.emit(vault, 'LoanExpired')
        .withArgs(0, borrower.address, (ts: bigint) => ts > 0n);

      const balanceAfter = await ethers.provider.getBalance(borrower.address);
      expect(balanceAfter - balanceBefore).to.equal(collateral);
    });

    it('reverts within deadline when loan is healthy (price feeds set)', async function () {
      // HF = (1 ETH * $3200 * 80%) / (2 MOCK * $1000) = $2560 / $2000 = 1.28 — healthy
      const { vault, mockToken, owner, borrower } = await deployForExpiryWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });

      await expect(vault.expireLoan(0)).to.be.revertedWith('Loan cannot be expired yet');
    });
  });

  describe('Chainlink & health factor', function () {
    async function deployWithFeeds() {
      const [owner, lender, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);

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
        vault.connect(borrower).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 18),
      ).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount');
    });

    it('setPriceFeed reverts if decimals_ exceeds 18', async function () {
      const { vault, ethFeed, owner } = await deployWithFeeds();
      await expect(
        vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 19),
      ).to.be.revertedWith('Decimals must be <= 18');
    });

    it('setPriceFeed reverts if decimals_ is 0', async function () {
      const { vault, ethFeed, owner } = await deployWithFeeds();
      await expect(
        vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 0),
      ).to.be.revertedWith('Decimals must be > 0');
    });

    it('getHealthFactor reverts if the price feed reports a stale round', async function () {
      const { vault, mockToken, ethFeed, lender, borrower, owner } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      await ethFeed.setStaleRound(true);

      await expect(vault.getHealthFactor(0)).to.be.revertedWith('Stale round');
    });

    it('getHealthFactor reverts if the price feed reports a future timestamp', async function () {
      const { vault, mockToken, ethFeed, lender, borrower, owner } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      const latestBlock = await ethers.provider.getBlock('latest');
      await ethFeed.setUpdatedAt(latestBlock!.timestamp + 3600);

      await expect(vault.getHealthFactor(0)).to.be.revertedWith('Price timestamp in the future');
    });

    it('getHealthFactor reverts if the price feed reports decimals > 18', async function () {
      const { vault, mockToken, ethFeed, lender, borrower, owner } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      await ethFeed.setDecimals(19);

      await expect(vault.getHealthFactor(0)).to.be.revertedWith('Feed decimals too large');
    });

    it('getHealthFactor returns correct value for ETH-collateral loan', async function () {
      // ETH collateral $3200, MOCK principal $1000 each, threshold 8000 bps (80%)
      // collateral = 1 ETH = 1e18 wei, borrow = 2 MOCK tokens
      // healthFactor = (1e18 * 3200e18 * 8000 * 1e18) / (2e18 * 1000e18 * 10000)
      //              = (3200 * 8000 * 1e18) / (2000 * 10000) = 1.28e18
      const { vault, mockToken, lender, borrower, owner } = await deployWithFeeds();

      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18); // 2 MOCK tokens
      const thresholdBps = 8000;

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(
          await mockToken.getAddress(),
          principal,
          0,
          0,
          7n * 86400n,
          thresholdBps,
          10000,
          ltvExpiry,
          ltvSig,
          { value: collateral },
        );

      // Fund the loan
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      const hf = await vault.getHealthFactor(0);
      // Expected: 1.28e18
      expect(hf).to.equal(128n * 10n ** 16n);
    });

    it('getHealthFactor works for unfunded loan using requestedPrincipalAmount', async function () {
      // ETH collateral $3200, MOCK principal $1000 each, threshold 8000 bps (80%)
      // HF = (1e18 * 3200e18 * 8000) / (2e18 * 1000e18 * 10000) = 1.28e18
      const { vault, mockToken, borrower, owner } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      const hf = await vault.getHealthFactor(0);
      expect(hf).to.equal(128n * 10n ** 16n); // 1.28e18
    });

    it('fundLoanWithERC20 reverts when loan is undercollateralized at funding time', async function () {
      // Collateral $100 ETH equivalent, borrow 2 MOCK at $1000 each => HF = 0.04 < 1
      const { vault, mockToken, lender, borrower, owner } = await deployWithFeeds();
      // ETH feed price = $3200, MOCK feed price = $1000 (set in deployWithFeeds)
      // Use tiny collateral and large principal to make HF < 1
      const collateral = ethers.parseEther('0.01'); // $32 collateral
      const principal = ethers.parseUnits('2', 18); // $2000 principal => HF=0.0128
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await expect(
        vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal),
      ).to.be.revertedWith('Loan is undercollateralized');
    });

    it('fundLoan reverts when loan is undercollateralized at funding time', async function () {
      // ETH collateral $3200, ETH principal $3200, threshold 8000 bps (80%)
      // collateral = 0.001 ETH = $3.20, principal = 1 ETH = $3200 => HF = 0.0008 < 1
      const { vault, borrower, lender, owner } = await deployWithFeeds();
      const collateral = ethers.parseEther('0.001'); // $3.20 collateral
      const principal = ethers.parseEther('1'); // $3200 principal => HF << 1
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      await expect(vault.connect(lender).fundLoan(0, { value: principal })).to.be.revertedWith(
        'Loan is undercollateralized',
      );
    });

    it('liquidate (ETH-principal entry) reverts when called on an ERC20-principal loan', async function () {
      const { vault, mockToken, lender, borrower, owner } = await deployWithFeeds();
      const collateral = ethers.parseEther('1');
      const principal = ethers.parseUnits('2', 18);
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      await expect(vault.liquidate(0, ethers.ZeroAddress)).to.be.revertedWith(
        'Loan has ERC20 principal; use liquidateWithERC20',
      );
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
      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        usdcAddress,
      );
      await vault
        .connect(borrower)
        .createLoan(usdcAddress, principalUsdc, 0, 0, 7n * 86400n, 9000, 10000, ltvExpiry, ltvSig, {
          value: collateralEth,
        });

      // Lender funds the loan (loan ID is 0 — first loan in this fixture)
      await vault.connect(lender).fundLoanWithERC20(0, usdcAddress, principalUsdc);

      const hf = await vault.getHealthFactor(0);
      // Expected: (3200 * 9000) / (1000 * 10000) * 1e18 = 2.88e18
      const expected = (3200n * 9000n * 10n ** 18n) / (1000n * 10000n);
      expect(hf).to.equal(expected);
    });

    // ---------------------------------------------------------------------------
    // liquidate / liquidateWithERC20
    // ---------------------------------------------------------------------------

    // Shared setup: ETH collateral ($3200), MOCK ERC20 principal ($1000), 18-dec both.
    // Borrower deposits 1 ETH collateral and requests 2 MOCK tokens.
    // liquidationThresholdBps = 8000 (80%), so HF = (1*3200*0.8) / (2*1000) = 1.28 initially.
    // Drop ETH price to $1000 → HF = (1*1000*0.8) / (2*1000) = 0.4 → liquidatable.
    async function deployForLiquidation() {
      const ctx = await deployWithFeeds();
      const { vault, mockToken, ethFeed, lender, borrower, owner } = ctx;

      const collateral = ethers.parseEther('1'); // 1 ETH
      const principal = ethers.parseUnits('2', 18); // 2 MOCK

      const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
        vault,
        owner,
        borrower.address,
        10000,
        ethers.ZeroAddress,
        await mockToken.getAddress(),
      );
      await vault
        .connect(borrower)
        .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
      await mockToken.transfer(lender.address, principal);
      await mockToken.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

      return { ...ctx, collateral, principal };
    }

    describe('setLiquidationBonusBps', function () {
      it('reverts for non-owner', async function () {
        const { vault, borrower } = await deployWithFeeds();
        await expect(vault.connect(borrower).setLiquidationBonusBps(500)).to.be.revertedWithCustomError(
          vault,
          'OwnableUnauthorizedAccount',
        );
      });

      it('reverts when bonus exceeds max (2000 bps)', async function () {
        const { vault, owner } = await deployWithFeeds();
        await expect(vault.connect(owner).setLiquidationBonusBps(2001)).to.be.revertedWith('Bonus exceeds max');
      });

      it('emits LiquidationBonusUpdated and stores value', async function () {
        const { vault, owner } = await deployWithFeeds();
        await expect(vault.connect(owner).setLiquidationBonusBps(1000))
          .to.emit(vault, 'LiquidationBonusUpdated')
          .withArgs(1000n);
        expect(await vault.liquidationBonusBps()).to.equal(1000n);
      });

      it('defaults to 500 (5%)', async function () {
        const { vault } = await deployWithFeeds();
        expect(await vault.liquidationBonusBps()).to.equal(500n);
      });
    });

    describe('liquidate (ETH principal)', function () {
      it('reverts when called on an ERC20-principal loan', async function () {
        const { vault, mockToken, lender, borrower, owner } = await deployWithFeeds();
        const collateral = ethers.parseEther('1');
        const principal = ethers.parseUnits('2', 18);
        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
          vault,
          owner,
          borrower.address,
          10000,
          ethers.ZeroAddress,
          await mockToken.getAddress(),
        );
        await vault
          .connect(borrower)
          .createLoan(await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
            value: collateral,
          });
        await mockToken.transfer(lender.address, principal);
        await mockToken.connect(lender).approve(await vault.getAddress(), principal);
        await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);
        // ETH principal route should reject for an ERC20-principal loan
        await expect(vault.liquidate(0, ethers.ZeroAddress, { value: principal })).to.be.revertedWith(
          'Loan has ERC20 principal; use liquidateWithERC20',
        );
      });

      it('reverts on unfunded loan', async function () {
        const { vault, owner } = await deployWithFeeds();
        const collateral = ethers.parseEther('1');
        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, owner.address, 10000);
        await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
        await expect(vault.liquidate(0, ethers.ZeroAddress, { value: collateral })).to.be.revertedWith(
          'Loan is not funded',
        );
      });

      it('expired ETH-principal loan: liquidator pays debt, lender paid, excess collateral returned, LoanLiquidated emitted', async function () {
        const { vault, ethFeed, lender, borrower, owner } = await deployWithFeeds();
        const [liquidator] = (await ethers.getSigners()).slice(3);

        // ETH-principal: collateral = 1.5 ETH, principal = 1 ETH, 30-day duration
        const collateral = ethers.parseEther('1.5');
        const principal = ethers.parseEther('1');
        const duration = 30n * 86400n;

        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, borrower.address, 10000);
        await vault
          .connect(borrower)
          .createLoan(ethers.ZeroAddress, principal, 0, duration, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
            value: collateral,
          });
        await vault.connect(lender).fundLoan(0, { value: principal });

        // Advance past duration then refresh feed so _getPrice doesn't revert on staleness
        await ethers.provider.send('evm_increaseTime', [30 * 86400 + 1]);
        await ethers.provider.send('evm_mine', []);
        await ethFeed.updateAnswer(3200n * 10n ** 8n); // same price, fresh timestamp

        const lenderBefore = await ethers.provider.getBalance(lender.address);
        const borrowerBefore = await ethers.provider.getBalance(borrower.address);

        const tx = await vault.connect(liquidator).liquidate(0, ethers.ZeroAddress, { value: principal });

        await expect(tx)
          .to.emit(vault, 'LoanLiquidated')
          .withArgs(
            0,
            liquidator.address,
            principal,
            (v: bigint) => v > 0n,
            (v: bigint) => v >= 0n,
            (v: bigint) => v > 0n,
          );

        const loan = await vault.loans(0);
        expect(loan.repaid).to.equal(true);

        // Lender received the debt repayment (no interest, no protocol fee on healthy close)
        expect(await ethers.provider.getBalance(lender.address)).to.be.gt(lenderBefore);
        // Borrower received excess collateral (1.5 ETH collateral - 1 ETH debt seized)
        expect(await ethers.provider.getBalance(borrower.address)).to.be.gt(borrowerBefore);
      });
    });

    describe('liquidateWithERC20 (ERC20 principal)', function () {
      it('reverts on a healthy non-expired loan', async function () {
        const { vault, mockToken, lender, borrower } = await deployForLiquidation();
        // health factor > 1 → not liquidatable
        await expect(vault.liquidateWithERC20(0, ethers.parseUnits('2', 18), ethers.ZeroAddress)).to.be.revertedWith(
          'Loan is not liquidatable',
        );
      });

      it('reverts when wrong entry point used (ETH-principal loan)', async function () {
        const { vault, owner } = await deployWithFeeds();
        const collateral = ethers.parseEther('1');
        // ETH-principal loan
        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(vault, owner, owner.address, 10000);
        await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
          value: collateral,
        });
        await expect(vault.liquidateWithERC20(0, collateral, ethers.ZeroAddress)).to.be.revertedWith(
          'Loan has ETH principal; use liquidate',
        );
      });

      it('reverts on already-repaid loan', async function () {
        const { vault, mockToken, lender, borrower } = await deployForLiquidation();
        // Repay the loan fully first
        const principal = ethers.parseUnits('2', 18);
        await mockToken.connect(borrower).approve(await vault.getAddress(), principal);
        await vault.connect(borrower).repayLoanWithERC20(0, principal);
        await expect(vault.liquidateWithERC20(0, principal, ethers.ZeroAddress)).to.be.revertedWith(
          'Loan already repaid',
        );
      });

      it('healthy-but-liquidatable: liquidator pays full debt, seizes debt*(1+bonus) collateral, borrower gets excess', async function () {
        // ETH $3200, MOCK $1000, threshold 8000 bps (80%), bonus 500 bps (5%)
        // After price crash to $1500: HF = (1*1500*0.8)/(2*1000) = 0.6 → liquidatable
        // debt = 2 MOCK = $2000
        // seizeUSD = $2000 * 1.05 = $2100
        // seizeCollateral = $2100 / $1500 = 1.4 ETH
        // BUT collateral = 1 ETH ($1500) < $2100 → this would be underwater...
        // Use price $2500 instead: HF = (1*2500*0.8)/(2*1000) = 1.0 → exactly at threshold
        // Drop to $2400: HF = (1*2400*0.8)/(2*1000) = 0.96 → liquidatable
        // seizeUSD = $2000 * 1.05 = $2100; seize = $2100 / $2400 = 0.875 ETH
        // excess collateral = 1 - 0.875 = 0.125 ETH → back to borrower
        const { vault, mockToken, ethFeed, lender, borrower, owner } = await deployForLiquidation();
        const [liquidator] = (await ethers.getSigners()).slice(3);

        await ethFeed.updateAnswer(2400n * 10n ** 8n); // $2400

        const debt = ethers.parseUnits('2', 18);
        await mockToken.transfer(liquidator.address, debt);
        await mockToken.connect(liquidator).approve(await vault.getAddress(), debt);

        const liquidatorEthBefore = await ethers.provider.getBalance(liquidator.address);
        const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);
        const lenderTokenBefore = await mockToken.balanceOf(lender.address);

        // seizeCollateral = floor(2000e18 * 1.05 / 2400) in wei
        // = floor(2100e18 / 2400) = floor(0.875e18) = 875000000000000000
        const expectedSeize = 875000000000000000n; // 0.875 ETH
        const expectedExcess = ethers.parseEther('1') - expectedSeize; // 0.125 ETH

        // Protocol fee = 0 (no interest accrued, interest-rate 0)
        const tx = await vault.connect(liquidator).liquidateWithERC20(0, debt, ethers.ZeroAddress);
        const receipt = await tx.wait();

        await expect(tx)
          .to.emit(vault, 'LoanLiquidated')
          .withArgs(0n, liquidator.address, debt, expectedSeize, expectedExcess, (t: bigint) => t > 0n);

        // Loan closed
        const loan = await vault.loans(0);
        expect(loan.repaid).to.equal(true);
        expect(loan.active).to.equal(false);

        // Liquidator received seized ETH
        const liquidatorEthAfter = await ethers.provider.getBalance(liquidator.address);
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        expect(liquidatorEthAfter - liquidatorEthBefore + gasUsed).to.equal(expectedSeize);

        // Borrower received excess ETH
        const borrowerEthAfter = await ethers.provider.getBalance(borrower.address);
        expect(borrowerEthAfter - borrowerEthBefore).to.equal(expectedExcess);

        // Lender received full debt (no protocol fee since interestRate=0)
        const lenderTokenAfter = await mockToken.balanceOf(lender.address);
        expect(lenderTokenAfter - lenderTokenBefore).to.equal(debt);
      });

      it('protocol fee on interest taken from lender payout on healthy close', async function () {
        // 10% APR, fund then wait 365 days → interestAccrued = 10% of 2 MOCK = 0.2 MOCK
        // debt = 2.2 MOCK; protocolFee = 10% of 0.2 MOCK = 0.02 MOCK
        // lender receives 2.2 - 0.02 = 2.18 MOCK
        // Use ETH price that keeps it liquidatable but not underwater:
        //   HF = (1 * P * 0.8) / (2.2 * 1000); need HF < 1 → P < 2750
        //   Use P = $2000: HF = 1600/2200 = 0.727 ✓
        //   seizeUSD = 2200 * 1.05 = 2310; seize = 2310/2000 = 1.155 ETH > 1 ETH → underwater
        //   Use P = $3000: HF = 2400/2200 = 1.09 > 1 → not liquidatable
        //   Use P = $2600: HF = 2080/2200 = 0.945 < 1 ✓
        //   seizeUSD = 2200 * 1.05 = 2310; seize = 2310/2600 = 0.888 ETH < 1 ETH ✓ (healthy close)
        const { vault, mockToken, ethFeed, mockFeed, lender, borrower, owner } = await deployWithFeeds();
        const [liquidator] = (await ethers.getSigners()).slice(3);

        const collateral = ethers.parseEther('1');
        const principal = ethers.parseUnits('2', 18);
        // 1000 bps (10%) APR, duration 365 days
        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
          vault,
          owner,
          borrower.address,
          10000,
          ethers.ZeroAddress,
          await mockToken.getAddress(),
        );
        await vault
          .connect(borrower)
          .createLoan(
            await mockToken.getAddress(),
            principal,
            1000,
            365n * 86400n,
            7n * 86400n,
            8000,
            10000,
            ltvExpiry,
            ltvSig,
            {
              value: collateral,
            },
          );
        await mockToken.transfer(lender.address, principal);
        await mockToken.connect(lender).approve(await vault.getAddress(), principal);
        await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

        // Advance 365 days so interest fully accrues, then refresh both feed timestamps
        await ethers.provider.send('evm_increaseTime', [365 * 86400]);
        await ethers.provider.send('evm_mine', []);

        // updateAnswer refreshes updatedAt on the mock, avoiding stale-price reverts
        await ethFeed.updateAnswer(2600n * 10n ** 8n); // $2600 → HF < 1
        await mockFeed.updateAnswer(1000n * 10n ** 8n); // keep MOCK at $1000, refresh timestamp

        // debt = principal + interest = 2 + 0.2 = 2.2 MOCK
        const debt = ethers.parseUnits('2', 18) + ethers.parseUnits('0.2', 18);
        await mockToken.transfer(liquidator.address, debt);
        await mockToken.connect(liquidator).approve(await vault.getAddress(), debt);

        const treasury = await vault.protocolTreasury();
        const treasuryBefore = await mockToken.balanceOf(treasury);
        const lenderBefore = await mockToken.balanceOf(lender.address);

        await vault.connect(liquidator).liquidateWithERC20(0, debt, ethers.ZeroAddress);

        // protocolFee = 10% of 0.2 MOCK = 0.02 MOCK
        const fee = ethers.parseUnits('0.02', 18);
        expect((await mockToken.balanceOf(treasury)) - treasuryBefore).to.equal(fee);
        expect((await mockToken.balanceOf(lender.address)) - lenderBefore).to.equal(debt - fee);
      });

      it('underwater: liquidator pays collateralValue/(1+bonus), lender eats shortfall, no protocol fee', async function () {
        // ETH price $900: collateralUSD = $900
        // debt = 2 MOCK = $2000 → deeply underwater
        // liquidatorPays = floor($900 / 1.05) in MOCK = floor(900/1050 * 2 MOCK)
        // = floor(900e18 / (1050 * 1e18 / 2e18))... let's compute precisely:
        // lockedUSD     = 1e18 * 900e18 / 1e18 = 900e18
        // payUSD        = 900e18 * 10000 / 10500 = 857142857142857142...
        // normalizedPay = 857142857142857142 * 1e18 / 1000e18 = 857142857142857 (units of 1e18 MOCK)
        // liquidatorPays = 857142857142857142857142857142857 / 1e18 → tricky, let compute in bigint
        // Actually: payUSD (1e18 scaled) = 900e18 * 10000 / 10500
        //           normalizedPay = payUSD * 1e18 / (1000 * 1e18) = payUSD / 1000
        //           liquidatorPays = normalizedPay (already in 18-dec MOCK, no denormalization needed)
        // = 900e18 * 10000 / 10500 / 1000 = 900e18 / 1050 = 857142857142857142... (truncated)
        const expectedPay = (900n * 10n ** 18n * 10000n) / (10500n * 1000n);
        // = 900 * 10000 / 10500000 * 1e18 = 857142857142857n (approx, bigint truncation)

        const { vault, mockToken, ethFeed, lender, borrower } = await deployForLiquidation();
        const [liquidator] = (await ethers.getSigners()).slice(3);

        await ethFeed.updateAnswer(900n * 10n ** 8n); // $900

        await mockToken.transfer(liquidator.address, expectedPay + 1n); // +1 for rounding
        await mockToken.connect(liquidator).approve(await vault.getAddress(), expectedPay + 1n);

        const lenderBefore = await mockToken.balanceOf(lender.address);
        const treasury = await vault.protocolTreasury();
        const treasuryBefore = await mockToken.balanceOf(treasury);
        const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);
        const liquidatorEthBefore = await ethers.provider.getBalance(liquidator.address);

        const tx = await vault.connect(liquidator).liquidateWithERC20(0, expectedPay + 1n, ethers.ZeroAddress);
        const receipt = await tx.wait();

        // All collateral goes to liquidator
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const liquidatorEthAfter = await ethers.provider.getBalance(liquidator.address);
        expect(liquidatorEthAfter - liquidatorEthBefore + gasUsed).to.equal(ethers.parseEther('1'));

        // Borrower gets nothing
        expect(await ethers.provider.getBalance(borrower.address)).to.equal(borrowerEthBefore);

        // No protocol fee when underwater
        expect(await mockToken.balanceOf(treasury)).to.equal(treasuryBefore);

        // Lender gets full liquidatorPays (no fee deduction)
        const lenderReceived = (await mockToken.balanceOf(lender.address)) - lenderBefore;
        expect(lenderReceived).to.be.gt(0n);
        expect(lenderReceived).to.be.lt(ethers.parseUnits('2', 18)); // less than full debt

        // Loan closed despite shortfall
        const loan = await vault.loans(0);
        expect(loan.repaid).to.equal(true);
        expect(loan.active).to.equal(false);
      });

      it('ceiling too low reverts with Exceeds max payment', async function () {
        // Use $2400 → healthy close, liquidatorPays == debt == 2 MOCK.
        // Providing maxAmount = 1 MOCK < 2 MOCK must revert.
        const { vault, mockToken, ethFeed, lender, borrower } = await deployForLiquidation();
        const [liquidator] = (await ethers.getSigners()).slice(3);
        await ethFeed.updateAnswer(2400n * 10n ** 8n); // $2400 → HF = 0.96 → liquidatable, healthy close
        const tooLow = ethers.parseUnits('1', 18); // less than debt (2 MOCK)
        await mockToken.transfer(liquidator.address, tooLow);
        await mockToken.connect(liquidator).approve(await vault.getAddress(), tooLow);
        await expect(vault.connect(liquidator).liquidateWithERC20(0, tooLow, ethers.ZeroAddress)).to.be.revertedWith(
          'Exceeds max payment',
        );
      });

      it('expired loan is liquidatable regardless of health factor', async function () {
        // durationSeconds = 30 days, no interest rate so debt stays at 2 MOCK
        // ETH at $3200 → HF = 1.28, healthy BUT expired after 30 days
        const { vault, mockToken, ethFeed, mockFeed, lender, borrower, owner } = await deployWithFeeds();
        const [liquidator] = (await ethers.getSigners()).slice(3);

        const collateral = ethers.parseEther('1');
        const principal = ethers.parseUnits('2', 18);
        const duration = 30n * 86400n;

        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
          vault,
          owner,
          borrower.address,
          10000,
          ethers.ZeroAddress,
          await mockToken.getAddress(),
        );
        await vault
          .connect(borrower)
          .createLoan(
            await mockToken.getAddress(),
            principal,
            0,
            duration,
            7n * 86400n,
            8000,
            10000,
            ltvExpiry,
            ltvSig,
            { value: collateral },
          );
        await mockToken.transfer(lender.address, principal);
        await mockToken.connect(lender).approve(await vault.getAddress(), principal);
        await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

        // Verify it's healthy before expiry
        const hfBefore = await vault.getHealthFactor(0);
        expect(hfBefore).to.be.gt(1n * 10n ** 18n);

        // Advance past duration then refresh feed timestamps so _getPrice doesn't revert
        await ethers.provider.send('evm_increaseTime', [30 * 86400 + 1]);
        await ethers.provider.send('evm_mine', []);
        await ethFeed.updateAnswer(3200n * 10n ** 8n); // same price, fresh timestamp
        await mockFeed.updateAnswer(1000n * 10n ** 8n); // same price, fresh timestamp

        const debt = ethers.parseUnits('2', 18);
        await mockToken.transfer(liquidator.address, debt);
        await mockToken.connect(liquidator).approve(await vault.getAddress(), debt);

        // Should succeed even though HF > 1
        await expect(vault.connect(liquidator).liquidateWithERC20(0, debt, ethers.ZeroAddress)).to.emit(
          vault,
          'LoanLiquidated',
        );

        const loan = await vault.loans(0);
        expect(loan.repaid).to.equal(true);
      });

      it('zero-duration loan is never expired (only undercollateralization triggers liquidation)', async function () {
        const { vault, mockToken, ethFeed, mockFeed, lender, borrower } = await deployForLiquidation();
        // durationSeconds = 0 in deployForLiquidation → no expiry
        // Advance far into the future then refresh feeds
        await ethers.provider.send('evm_increaseTime', [365 * 86400 * 10]);
        await ethers.provider.send('evm_mine', []);
        await ethFeed.updateAnswer(3200n * 10n ** 8n);
        await mockFeed.updateAnswer(1000n * 10n ** 8n);
        // HF still > 1 (price unchanged at $3200)
        await expect(vault.liquidateWithERC20(0, ethers.parseUnits('2', 18), ethers.ZeroAddress)).to.be.revertedWith(
          'Loan is not liquidatable',
        );
      });

      it('explicit collateralRecipient receives seized collateral instead of msg.sender', async function () {
        const { vault, mockToken, ethFeed, lender, borrower } = await deployForLiquidation();
        const signers = await ethers.getSigners();
        const liquidator = signers[3];
        const treasury = signers[4];

        await ethFeed.updateAnswer(2400n * 10n ** 8n); // HF < 1, healthy close

        const debt = ethers.parseUnits('2', 18);
        await mockToken.transfer(liquidator.address, debt);
        await mockToken.connect(liquidator).approve(await vault.getAddress(), debt);

        const treasuryEthBefore = await ethers.provider.getBalance(treasury.address);
        const liquidatorEthBefore = await ethers.provider.getBalance(liquidator.address);

        const tx = await vault.connect(liquidator).liquidateWithERC20(0, debt, treasury.address);
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

        // seize = debt($2000) * 1.05 / $2400 = 2000*1.05/2400 ETH = 0.875 ETH
        const expectedSeize = (2000n * 10n ** 18n * 10500n) / (10000n * 2400n);
        expect((await ethers.provider.getBalance(treasury.address)) - treasuryEthBefore).to.equal(expectedSeize);
        // Liquidator ETH balance only decreases by gas (no collateral received)
        expect(liquidatorEthBefore - (await ethers.provider.getBalance(liquidator.address))).to.equal(gasUsed);
      });

      it('mismatched decimals: 18-dec ETH collateral, 6-dec USDC principal', async function () {
        // ETH $3200 (18-dec collateral), USDC $1 (6-dec principal)
        // Borrow 1000 USDC against 1 ETH → HF = (1*3200*0.8)/(1000*1) = 2.56 healthy
        // Drop ETH to $1100: HF = (1*1100*0.8)/(1000*1) = 0.88 → liquidatable
        // debt = 1000 USDC = 1000e6
        // seizeUSD = 1000e18 * 1.05 = 1050e18
        // seizeCollateral (normalized) = 1050e18 / 1100e18 = 0.9545...e18
        // seizeCollateral (denormalized 18-dec ETH) = 0.9545e18 wei < 1 ETH ✓ healthy close
        const { vault, owner, lender, borrower } = await deployWithFeeds();
        const [liquidator] = (await ethers.getSigners()).slice(3);

        const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
        const MockERC20 = await ethers.getContractFactory('MockERC20');
        const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n);
        const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6, 0n);
        await vault.connect(owner).setPriceFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 6);

        const collateralEth = ethers.parseEther('1');
        const principalUsdc = ethers.parseUnits('1000', 6);
        await usdc.mint(lender.address, principalUsdc);
        await usdc.connect(lender).approve(await vault.getAddress(), principalUsdc);

        const { expiry: ltvExpiry, sig: ltvSig } = await signLtvAttestation(
          vault,
          owner,
          borrower.address,
          10000,
          ethers.ZeroAddress,
          await usdc.getAddress(),
        );
        await vault
          .connect(borrower)
          .createLoan(await usdc.getAddress(), principalUsdc, 0, 0, 7n * 86400n, 8000, 10000, ltvExpiry, ltvSig, {
            value: collateralEth,
          });
        await vault.connect(lender).fundLoanWithERC20(0, await usdc.getAddress(), principalUsdc);

        // Drop ETH to $1100
        const MockAggFactory = await ethers.getContractFactory('MockV3Aggregator');
        // re-use ethFeed from deployWithFeeds via vault's registered feed
        // deployWithFeeds already set the ETH feed — need a reference to it
        // We'll set a new feed for ETH at $1100
        const ethFeed1100 = await MockAggFactory.deploy(8, 1100n * 10n ** 8n);
        await vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed1100.getAddress(), 18);

        await usdc.mint(liquidator.address, principalUsdc);
        await usdc.connect(liquidator).approve(await vault.getAddress(), principalUsdc);

        const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);
        const liquidatorEthBefore = await ethers.provider.getBalance(liquidator.address);
        const lenderUsdcBefore = await usdc.balanceOf(lender.address);

        const tx = await vault.connect(liquidator).liquidateWithERC20(0, principalUsdc, ethers.ZeroAddress);
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

        // seize = floor(1000e18 * 1.05 / 1100e18 * 1e18) in wei (ETH 18-dec, no denorm needed)
        const seize = (1000n * 10n ** 18n * 10500n) / (10000n * 1100n);

        const liquidatorEthAfter = await ethers.provider.getBalance(liquidator.address);
        expect(liquidatorEthAfter - liquidatorEthBefore + gasUsed).to.equal(seize);

        const excess = collateralEth - seize;
        const borrowerEthAfter = await ethers.provider.getBalance(borrower.address);
        expect(borrowerEthAfter - borrowerEthBefore).to.equal(excess);

        // Lender paid full debt (no interest, no fee)
        expect((await usdc.balanceOf(lender.address)) - lenderUsdcBefore).to.equal(principalUsdc);
      });
    });
  });

  describe('lendOffer', function () {
    // collateralRatioBps=16000 (160%), trustedRatioBps=0, scoreThreshold=0, maxLtvBps=6500, interestRateBps=800
    const RATIO = 16000;
    const TRUSTED = 0;
    const SCORE_THRESH = 0;
    const LTV = 6500;
    const RATE = 800;
    const DURATION = 30n * 86400n;
    const WINDOW = 7n * 86400n;

    async function deployFixture() {
      const [owner, lender, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      await vault.setScoreSigner(owner.address);
      // ETH price feed required by acceptLendOffer → _checkCollateralValue → _getPrice
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n); // ETH = $3200
      await vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 18);
      return { vault, owner, lender, borrower };
    }

    it('createLendOffer: locks ETH principal, emits LendOfferCreated', async function () {
      const { vault, lender } = await deployFixture();
      const principal = ethers.parseEther('1.0');
      const tx = await vault
        .connect(lender)
        .createLendOffer(RATIO, TRUSTED, SCORE_THRESH, LTV, RATE, DURATION, WINDOW, { value: principal });
      await expect(tx).to.emit(vault, 'LendOfferCreated').withArgs(1, lender.address, ethers.ZeroAddress, principal);

      const offer = await vault.lendOffers(1);
      expect(offer.lender).to.equal(lender.address);
      expect(offer.principalAmount).to.equal(principal);
      expect(offer.active).to.equal(true);
      expect(offer.accepted).to.equal(false);
    });

    it('createLendOffer: reverts if msg.value is 0', async function () {
      const { vault, lender } = await deployFixture();
      await expect(
        vault.connect(lender).createLendOffer(RATIO, TRUSTED, SCORE_THRESH, LTV, RATE, DURATION, WINDOW, { value: 0 }),
      ).to.be.revertedWith('Principal must be > 0');
    });

    it('acceptLendOffer: borrower posts ETH collateral, creates loan, emits LendOfferAccepted', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const principal = ethers.parseEther('1.0');
      // At ETH=$3200 and collateralRatioBps=16000 (160%), need collateral ≥ principal * 1.6
      // principal USD = 1 ETH * $3200 = $3200; minimum collateral USD = $3200 * 1.6 = $5120
      // collateral ETH needed = $5120 / $3200 = 1.6 ETH
      const collateral = ethers.parseEther('1.6');
      await vault
        .connect(lender)
        .createLendOffer(RATIO, TRUSTED, SCORE_THRESH, LTV, RATE, DURATION, WINDOW, { value: principal });
      const tx = await vault.connect(borrower).acceptLendOffer(1, 0, 0, '0x', { value: collateral });
      await expect(tx).to.emit(vault, 'LendOfferAccepted').withArgs(1, 0, borrower.address);

      const offer = await vault.lendOffers(1);
      expect(offer.accepted).to.equal(true);
      expect(offer.acceptedLoanId).to.equal(0);

      const loan = await vault.loans(0);
      expect(loan.borrower).to.equal(borrower.address);
      expect(loan.lender).to.equal(lender.address);
      expect(loan.funded).to.equal(true);
      expect(loan.lendOfferId).to.equal(1);
    });

    it('acceptLendOffer: reverts if collateral value below required ratio', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(lender)
        .createLendOffer(RATIO, TRUSTED, SCORE_THRESH, LTV, RATE, DURATION, WINDOW, { value: principal });
      // 1.0 ETH collateral < 1.6 ETH required at 160% ratio
      await expect(
        vault.connect(borrower).acceptLendOffer(1, 0, 0, '0x', { value: ethers.parseEther('1.0') }),
      ).to.be.revertedWith('Collateral value below required ratio');
    });

    it('cancelLendOffer: lender reclaims ETH principal, emits LendOfferCancelled', async function () {
      const { vault, lender } = await deployFixture();
      const principal = ethers.parseEther('1.0');
      await vault
        .connect(lender)
        .createLendOffer(RATIO, TRUSTED, SCORE_THRESH, LTV, RATE, DURATION, WINDOW, { value: principal });
      const balBefore = await ethers.provider.getBalance(lender.address);
      const tx = await vault.connect(lender).cancelLendOffer(1);
      await expect(tx).to.emit(vault, 'LendOfferCancelled').withArgs(1, lender.address);
      const offer = await vault.lendOffers(1);
      expect(offer.active).to.equal(false);
      const balAfter = await ethers.provider.getBalance(lender.address);
      expect(balAfter).to.be.gt(balBefore); // got refund (minus gas)
    });

    it('expireLendOffer: permissionless after acceptDeadline, returns ETH principal', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const principal = ethers.parseEther('1.0');
      await vault.connect(lender).createLendOffer(
        RATIO,
        TRUSTED,
        SCORE_THRESH,
        LTV,
        RATE,
        DURATION,
        1n, // 1s accept window
        { value: principal },
      );
      // advance time past acceptDeadline
      await ethers.provider.send('evm_increaseTime', [10]);
      await ethers.provider.send('evm_mine', []);
      const tx = await vault.connect(borrower).expireLendOffer(1);
      await expect(tx).to.emit(vault, 'LendOfferExpired').withArgs(1);
      const offer = await vault.lendOffers(1);
      expect(offer.active).to.equal(false);
    });

    it('createLendOfferWithERC20: locks ERC20 principal, emits LendOfferCreated', async function () {
      const { vault, lender, owner } = await deployFixture();
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6, ethers.parseUnits('10000', 6));
      const usdcAddress = await usdc.getAddress();
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n); // USDC = $1
      await vault.connect(owner).setPriceFeed(usdcAddress, await usdcFeed.getAddress(), 6);

      const principal = ethers.parseUnits('100', 6); // 100 USDC
      await usdc.transfer(lender.address, principal);
      await usdc.connect(lender).approve(await vault.getAddress(), principal);

      const tx = await vault
        .connect(lender)
        .createLendOfferWithERC20(usdcAddress, principal, RATIO, TRUSTED, SCORE_THRESH, LTV, RATE, DURATION, WINDOW);
      await expect(tx).to.emit(vault, 'LendOfferCreated').withArgs(1, lender.address, usdcAddress, principal);

      const offer = await vault.lendOffers(1);
      expect(offer.lender).to.equal(lender.address);
      expect(offer.principalToken).to.equal(usdcAddress);
      expect(offer.principalAmount).to.equal(principal);
      expect(offer.active).to.equal(true);
    });

    it('acceptLendOfferWithERC20: borrower posts ERC20 collateral, creates loan', async function () {
      const { vault, lender, borrower, owner } = await deployFixture();
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6, ethers.parseUnits('10000', 6));
      const wbtc = await MockERC20.deploy('Wrapped BTC', 'WBTC', 8, ethers.parseUnits('10', 8));
      const usdcAddress = await usdc.getAddress();
      const wbtcAddress = await wbtc.getAddress();
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n); // USDC = $1
      const wbtcFeed = await MockAgg.deploy(8, 30000n * 10n ** 8n); // WBTC = $30,000
      await vault.connect(owner).setPriceFeed(usdcAddress, await usdcFeed.getAddress(), 6);
      await vault.connect(owner).setPriceFeed(wbtcAddress, await wbtcFeed.getAddress(), 8);

      // principal = 100 USDC; at 160% ratio: need $160 collateral = 160/30000 WBTC ≈ 0.00533…
      const principal = ethers.parseUnits('100', 6);
      await usdc.transfer(lender.address, principal);
      await usdc.connect(lender).approve(await vault.getAddress(), principal);
      await vault
        .connect(lender)
        .createLendOfferWithERC20(usdcAddress, principal, RATIO, TRUSTED, SCORE_THRESH, LTV, RATE, DURATION, WINDOW);

      // collateral: ceil(100e6 * 16000 * 1e9 * 1e8 / (10000 * 30000e9 * 1e6)) = ceil(160e8/30000) = 534
      const collateral = ethers.parseUnits('0.01', 8); // 0.01 WBTC = $300, well above $160
      await wbtc.transfer(borrower.address, collateral);
      await wbtc.connect(borrower).approve(await vault.getAddress(), collateral);

      const tx = await vault.connect(borrower).acceptLendOfferWithERC20(1, wbtcAddress, collateral, 0, 0, '0x');
      await expect(tx).to.emit(vault, 'LendOfferAccepted').withArgs(1, 0, borrower.address);

      const offer = await vault.lendOffers(1);
      expect(offer.accepted).to.equal(true);

      const loan = await vault.loans(0);
      expect(loan.collateralToken).to.equal(wbtcAddress);
      expect(loan.lendOfferId).to.equal(1);
    });

    it('acceptLendOffer: trusted ratio applied when valid attestation provided', async function () {
      const { vault, lender, borrower, owner } = await deployFixture();
      // 200% base, 120% trusted for score >= 700; maxLtvBps must cover trusted ratio: ceil(10000²/12000) = 8334
      const [signerWallet] = await ethers.getSigners();
      await vault.connect(owner).setScoreSigner(signerWallet.address);

      const TRUSTED_RATIO = 12000; // 120%
      const SCORE_MIN = 700;
      const MAX_LTV = 8334; // ceil(10000*10000/12000)
      await vault.connect(lender).createLendOffer(20000, TRUSTED_RATIO, SCORE_MIN, MAX_LTV, RATE, DURATION, WINDOW, {
        value: ethers.parseEther('1.0'),
      });

      // Sign attestation: keccak256(borrower, score, expiry, vaultAddress, chainId)
      const score = 800;
      const latestBlock = await ethers.provider.getBlock('latest');
      const expiry = latestBlock!.timestamp + 3600;
      const vaultAddress = await vault.getAddress();
      const network = await ethers.provider.getNetwork();
      const msgHash = ethers.solidityPackedKeccak256(
        ['address', 'uint16', 'uint256', 'address', 'uint256'],
        [borrower.address, score, expiry, vaultAddress, network.chainId],
      );
      const sig = await signerWallet.signMessage(ethers.getBytes(msgHash));

      // At 120% trusted ratio, need 1 ETH * 1.2 = 1.2 ETH collateral (< 2 ETH base)
      const collateral = ethers.parseEther('1.2');
      const tx = await vault.connect(borrower).acceptLendOffer(1, score, expiry, sig, { value: collateral });
      await expect(tx).to.emit(vault, 'LendOfferAccepted').withArgs(1, 0, borrower.address);

      // Confirm 1.2 ETH would have been rejected at base 200% ratio
      await vault.connect(lender).createLendOffer(20000, TRUSTED_RATIO, SCORE_MIN, MAX_LTV, RATE, DURATION, WINDOW, {
        value: ethers.parseEther('1.0'),
      });
      await expect(vault.connect(borrower).acceptLendOffer(2, 0, 0, '0x', { value: collateral })).to.be.revertedWith(
        'Collateral value below required ratio',
      );
    });
  });

  describe('signedOrders', function () {
    const RATIO = 16000,
      TRUSTED = 0,
      SCORE_THRESH = 0,
      LTV = 6500,
      RATE = 800;
    const DURATION = 30n * 86400n;

    async function deployFixture() {
      const [owner, lender, borrower] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
      await vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 18);
      return { vault, owner, lender, borrower };
    }

    it('hashLoanRequest matches ethers TypedDataEncoder', async function () {
      const { vault, borrower } = await deployFixture();
      const net = await ethers.provider.getNetwork();
      const domain = { name: 'Vouch', version: '1', chainId: net.chainId, verifyingContract: await vault.getAddress() };
      const types = {
        LoanRequest: [
          { name: 'borrower', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'collateralAmount', type: 'uint256' },
          { name: 'principalToken', type: 'address' },
          { name: 'principalAmount', type: 'uint256' },
          { name: 'interestRateBps', type: 'uint16' },
          { name: 'durationSeconds', type: 'uint256' },
          { name: 'maxLtvBps', type: 'uint16' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      const req = {
        borrower: borrower.address,
        collateralToken: '0x0000000000000000000000000000000000000001',
        collateralAmount: ethers.parseEther('2'),
        principalToken: ethers.ZeroAddress,
        principalAmount: ethers.parseEther('1'),
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 7n,
        deadline: 9999999999n,
      };
      const expected = ethers.TypedDataEncoder.hash(domain, types, req);
      expect(await vault.hashLoanRequest(req)).to.equal(expected);
    });

    async function signLoanRequest(vault: any, signer: any, req: any) {
      const net = await ethers.provider.getNetwork();
      const domain = { name: 'Vouch', version: '1', chainId: net.chainId, verifyingContract: await vault.getAddress() };
      const types = {
        LoanRequest: [
          { name: 'borrower', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'collateralAmount', type: 'uint256' },
          { name: 'principalToken', type: 'address' },
          { name: 'principalAmount', type: 'uint256' },
          { name: 'interestRateBps', type: 'uint16' },
          { name: 'durationSeconds', type: 'uint256' },
          { name: 'maxLtvBps', type: 'uint16' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      return signer.signTypedData(domain, types, req);
    }

    it('fillLoanRequest: lender fills ERC20-collateral / ETH-principal request', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      // Collateral token = mock WBTC at $64000, 8 decimals
      const Mock = await ethers.getContractFactory('MockERC20');
      const wbtc = await Mock.deploy('WBTC', 'WBTC', 8, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const wbtcFeed = await MockAgg.deploy(8, 64000n * 10n ** 8n);
      await vault.connect(owner).setPriceFeed(await wbtc.getAddress(), await wbtcFeed.getAddress(), 8);

      const principal = ethers.parseEther('1'); // $3200
      // need collateral USD >= principal * 1.6 = $5120 -> in WBTC: 5120/64000 = 0.08 WBTC
      const collateral = 8n * 10n ** 6n; // 0.08 WBTC (8 decimals)
      await wbtc.mint(borrower.address, collateral);
      await wbtc.connect(borrower).approve(await vault.getAddress(), collateral);

      const req = {
        borrower: borrower.address,
        collateralToken: await wbtc.getAddress(),
        collateralAmount: collateral,
        principalToken: ethers.ZeroAddress,
        principalAmount: principal,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const sig = await signLoanRequest(vault, borrower, req);
      const digest = await vault.hashLoanRequest(req);

      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: principal }))
        .to.emit(vault, 'SignedLoanRequestFilled')
        .withArgs(
          0,
          digest,
          borrower.address,
          lender.address,
          await wbtc.getAddress(),
          collateral,
          ethers.ZeroAddress,
          principal,
          anyValue,
        );

      const loan = await vault.loans(0);
      expect(loan.borrower).to.equal(borrower.address);
      expect(loan.lender).to.equal(lender.address);
      expect(await vault.consumedSignatures(digest)).to.equal(true);
    });

    it('fillLoanRequest: reverts on wrong signer', async function () {
      const { vault, lender, borrower, owner } = await deployFixture();
      const req = {
        borrower: borrower.address,
        collateralToken: '0x0000000000000000000000000000000000000001',
        collateralAmount: 1n,
        principalToken: ethers.ZeroAddress,
        principalAmount: 1n,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const sig = await signLoanRequest(vault, owner, req); // wrong signer
      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 1n })).to.be.revertedWith(
        'Invalid signature',
      );
    });

    it('fillLoanRequest: reverts when already consumed', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const wbtc = await Mock.deploy('WBTC', 'WBTC', 8, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const wbtcFeed = await MockAgg.deploy(8, 64000n * 10n ** 8n);
      await vault.connect(owner).setPriceFeed(await wbtc.getAddress(), await wbtcFeed.getAddress(), 8);
      const principal = ethers.parseEther('1');
      const collateral = 8n * 10n ** 6n;
      await wbtc.mint(borrower.address, collateral * 2n);
      await wbtc.connect(borrower).approve(await vault.getAddress(), collateral * 2n);
      const req = {
        borrower: borrower.address,
        collateralToken: await wbtc.getAddress(),
        collateralAmount: collateral,
        principalToken: ethers.ZeroAddress,
        principalAmount: principal,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const sig = await signLoanRequest(vault, borrower, req);
      await vault.connect(lender).fillLoanRequest(req, sig, { value: principal });
      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: principal })).to.be.revertedWith(
        'Signature already used',
      );
    });

    it('fillLoanRequest: reverts on ETH collateral (address(0))', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const req = {
        borrower: borrower.address,
        collateralToken: ethers.ZeroAddress,
        collateralAmount: 1n,
        principalToken: ethers.ZeroAddress,
        principalAmount: 1n,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const sig = await signLoanRequest(vault, borrower, req);
      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 1n })).to.be.revertedWith(
        'Collateral must be ERC20',
      );
    });

    it('fillLoanRequest: reverts when collateral is above broken LTV threshold but below correct ratio', async function () {
      // This test catches the inverted-formula bug. Setup:
      //   principal = 1 ETH @ $3200 -> principalUsd = $3200
      //   maxLtvBps = 6500 (65% LTV)
      //   Correct min collateral: $3200 * (10000/6500) = $3200 * 1.53846 ~= $4923
      //   Broken min collateral:  $3200 * (6500/10000) = $3200 * 0.65   = $2080
      //   Test collateral: 0.055 WBTC @ $64000 = $3520
      //   $3520 > $2080 (would pass broken check) but $3520 < $4923 (must revert with correct check)
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const wbtc = await Mock.deploy('WBTC', 'WBTC', 8, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const wbtcFeed = await MockAgg.deploy(8, 64000n * 10n ** 8n);
      await vault.connect(owner).setPriceFeed(await wbtc.getAddress(), await wbtcFeed.getAddress(), 8);

      const principal = ethers.parseEther('1'); // $3200
      // 0.055 WBTC = 5_500_000 satoshis (8 decimals); worth $3520 — above broken floor ($2080) but below correct floor (~$4923)
      const collateral = 55n * 10n ** 5n; // 0.055 WBTC
      await wbtc.mint(borrower.address, collateral);
      await wbtc.connect(borrower).approve(await vault.getAddress(), collateral);

      const req = {
        borrower: borrower.address,
        collateralToken: await wbtc.getAddress(),
        collateralAmount: collateral,
        principalToken: ethers.ZeroAddress,
        principalAmount: principal,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 2n,
        deadline: 9999999999n,
      };
      const sig = await signLoanRequest(vault, borrower, req);
      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: principal })).to.be.revertedWith(
        'Collateral value below required ratio',
      );
    });

    it('fillLoanRequest: reverts when principalAmount is zero', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const req = {
        borrower: borrower.address,
        collateralToken: '0x0000000000000000000000000000000000000001',
        collateralAmount: 1n,
        principalToken: ethers.ZeroAddress,
        principalAmount: 0n,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const sig = await signLoanRequest(vault, borrower, req);
      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 0n })).to.be.revertedWith(
        'Principal must be > 0',
      );
    });

    // --- signLendOffer helper ---
    async function signLendOffer(vault: any, signer: any, offer: any) {
      const net = await ethers.provider.getNetwork();
      const domain = { name: 'Vouch', version: '1', chainId: net.chainId, verifyingContract: await vault.getAddress() };
      const types = {
        LendOffer: [
          { name: 'lender', type: 'address' },
          { name: 'principalToken', type: 'address' },
          { name: 'principalAmount', type: 'uint256' },
          { name: 'collateralRatioBps', type: 'uint16' },
          { name: 'trustedRatioBps', type: 'uint16' },
          { name: 'scoreThreshold', type: 'uint16' },
          { name: 'maxLtvBps', type: 'uint16' },
          { name: 'interestRateBps', type: 'uint16' },
          { name: 'durationSeconds', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      return signer.signTypedData(domain, types, offer);
    }

    it('fillLendOffer: borrower fills ERC20-principal / ETH-collateral offer', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n); // $1
      await vault.connect(owner).setPriceFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 6);

      const principal = 3200n * 10n ** 6n; // 3200 USDC = $3200
      await usdc.mint(lender.address, principal);
      await usdc.connect(lender).approve(await vault.getAddress(), principal);

      // ETH collateral supplied by borrower; ratio 160% -> need $5120 -> 1.6 ETH at $3200
      const collateral = ethers.parseEther('1.6');
      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: principal,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const sig = await signLendOffer(vault, lender, offer);
      const digest = await vault.hashLendOffer(offer);

      await expect(vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: collateral }))
        .to.emit(vault, 'SignedLendOfferFilled')
        .withArgs(
          0,
          digest,
          lender.address,
          borrower.address,
          await usdc.getAddress(),
          principal,
          ethers.ZeroAddress,
          collateral,
          anyValue,
        );

      const loan = await vault.loans(0);
      expect(loan.lender).to.equal(lender.address);
      expect(loan.borrower).to.equal(borrower.address);
      expect(await vault.consumedSignatures(digest)).to.equal(true);
    });

    it('fillLendOffer: borrower fills ERC20-principal / ERC20-collateral offer', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const weth = await Mock.deploy('WETH', 'WETH', 18, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n); // USDC = $1
      const wethFeed = await MockAgg.deploy(8, 2000n * 10n ** 8n); // WETH = $2000
      await vault.connect(owner).setPriceFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 6);
      await vault.connect(owner).setPriceFeed(await weth.getAddress(), await wethFeed.getAddress(), 18);

      // principal = 1000 USDC = $1000
      // ratio 160% -> need collateral USD >= $1600 -> 0.8 WETH at $2000
      const principal = 1000n * 10n ** 6n;
      const collateralAmount = ethers.parseEther('0.8'); // 0.8 WETH = $1600

      await usdc.mint(lender.address, principal);
      await usdc.connect(lender).approve(await vault.getAddress(), principal);
      await weth.mint(borrower.address, collateralAmount);
      await weth.connect(borrower).approve(await vault.getAddress(), collateralAmount);

      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: principal,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 2n,
        deadline: 9999999999n,
      };
      const sig = await signLendOffer(vault, lender, offer);
      const digest = await vault.hashLendOffer(offer);

      await expect(vault.connect(borrower).fillLendOffer(offer, await weth.getAddress(), collateralAmount, sig))
        .to.emit(vault, 'SignedLendOfferFilled')
        .withArgs(
          0,
          digest,
          lender.address,
          borrower.address,
          await usdc.getAddress(),
          principal,
          await weth.getAddress(),
          collateralAmount,
          anyValue,
        );

      const loan = await vault.loans(0);
      expect(loan.lender).to.equal(lender.address);
      expect(loan.borrower).to.equal(borrower.address);
      expect(loan.collateralToken).to.equal(await weth.getAddress());
      expect(loan.collateralAmount).to.equal(collateralAmount);
      expect(await vault.consumedSignatures(digest)).to.equal(true);
    });

    it('fillLendOffer: reverts on ETH principal (address(0))', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const offer = {
        lender: lender.address,
        principalToken: ethers.ZeroAddress,
        principalAmount: 1n,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const sig = await signLendOffer(vault, lender, offer);
      await expect(
        vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: 1n }),
      ).to.be.revertedWith('Principal must be ERC20');
    });

    it('cancelSignedLoanRequest: borrower cancels, then fill reverts', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const req = {
        borrower: borrower.address,
        collateralToken: '0x0000000000000000000000000000000000000001',
        collateralAmount: 1n,
        principalToken: ethers.ZeroAddress,
        principalAmount: 1n,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 1n,
        deadline: 9999999999n,
      };
      const digest = await vault.hashLoanRequest(req);
      await expect(vault.connect(borrower).cancelSignedLoanRequest(req))
        .to.emit(vault, 'SignedLoanRequestCancelled')
        .withArgs(digest, borrower.address);
      const sig = await signLoanRequest(vault, borrower, req);
      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 1n })).to.be.revertedWith(
        'Signature already used',
      );
    });

    it('cancelSignedLoanRequest: reverts if caller is not borrower', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const req = {
        borrower: borrower.address,
        collateralToken: '0x0000000000000000000000000000000000000001',
        collateralAmount: 1n,
        principalToken: ethers.ZeroAddress,
        principalAmount: 1n,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 1n,
        deadline: 9999999999n,
      };
      await expect(vault.connect(lender).cancelSignedLoanRequest(req)).to.be.revertedWith('Not signer');
    });

    it('fillLoanRequest: reverts on expired deadline', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const latestBlock = await ethers.provider.getBlock('latest');
      const pastDeadline = BigInt(latestBlock!.timestamp - 1);
      const req = {
        borrower: borrower.address,
        collateralToken: '0x0000000000000000000000000000000000000001',
        collateralAmount: 1n,
        principalToken: ethers.ZeroAddress,
        principalAmount: 1n,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 10n,
        deadline: pastDeadline,
      };
      const sig = await signLoanRequest(vault, borrower, req);
      await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 1n })).to.be.revertedWith(
        'Request expired',
      );
    });

    it('fillLoanRequest: lender fills ERC20-collateral / ERC20-principal request', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const wbtc = await Mock.deploy('WBTC', 'WBTC', 8, 0);
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const wbtcFeed = await MockAgg.deploy(8, 64000n * 10n ** 8n); // WBTC = $64000
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n); // USDC = $1
      await vault.connect(owner).setPriceFeed(await wbtc.getAddress(), await wbtcFeed.getAddress(), 8);
      await vault.connect(owner).setPriceFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 6);

      // principal = 3200 USDC = $3200; collateralRatio ~153.8% at LTV 65%
      // min collateral: $3200 * (10000/6500) ~= $4923 -> 0.077 WBTC at $64000
      const principal = 3200n * 10n ** 6n;
      const collateral = 8n * 10n ** 6n; // 0.08 WBTC = $5120 > $4923

      await wbtc.mint(borrower.address, collateral);
      await wbtc.connect(borrower).approve(await vault.getAddress(), collateral);
      await usdc.mint(lender.address, principal);
      await usdc.connect(lender).approve(await vault.getAddress(), principal);

      const req = {
        borrower: borrower.address,
        collateralToken: await wbtc.getAddress(),
        collateralAmount: collateral,
        principalToken: await usdc.getAddress(),
        principalAmount: principal,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        maxLtvBps: LTV,
        nonce: 11n,
        deadline: 9999999999n,
      };
      const sig = await signLoanRequest(vault, borrower, req);
      const digest = await vault.hashLoanRequest(req);

      await expect(vault.connect(lender).fillLoanRequest(req, sig))
        .to.emit(vault, 'SignedLoanRequestFilled')
        .withArgs(
          0,
          digest,
          borrower.address,
          lender.address,
          await wbtc.getAddress(),
          collateral,
          await usdc.getAddress(),
          principal,
          anyValue,
        );

      const loan = await vault.loans(0);
      expect(loan.borrower).to.equal(borrower.address);
      expect(loan.lender).to.equal(lender.address);
      expect(loan.requestedPrincipalToken).to.equal(await usdc.getAddress());
      expect(await vault.consumedSignatures(digest)).to.equal(true);
    });

    it('fillLendOffer: reverts on wrong signer', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: 1000n * 10n ** 6n,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 10n,
        deadline: 9999999999n,
      };
      const sig = await signLendOffer(vault, owner, offer); // wrong signer
      await expect(
        vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: ethers.parseEther('1') }),
      ).to.be.revertedWith('Invalid signature');
    });

    it('fillLendOffer: reverts when already consumed', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n);
      await vault.connect(owner).setPriceFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 6);

      // 1600 USDC = $1600; 160% ratio -> need $2560 -> 0.8 ETH at $3200
      const principal = 1600n * 10n ** 6n;
      const collateral = ethers.parseEther('0.8');
      await usdc.mint(lender.address, principal * 2n);
      await usdc.connect(lender).approve(await vault.getAddress(), principal * 2n);

      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: principal,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 11n,
        deadline: 9999999999n,
      };
      const sig = await signLendOffer(vault, lender, offer);
      await vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: collateral });
      await expect(
        vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: collateral }),
      ).to.be.revertedWith('Signature already used');
    });

    it('fillLendOffer: reverts on expired deadline', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const latestBlock = await ethers.provider.getBlock('latest');
      const pastDeadline = BigInt(latestBlock!.timestamp - 1);
      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: 1000n * 10n ** 6n,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 12n,
        deadline: pastDeadline,
      };
      const sig = await signLendOffer(vault, lender, offer);
      await expect(
        vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: ethers.parseEther('1') }),
      ).to.be.revertedWith('Offer expired');
    });

    it('fillLendOffer: reverts when collateral below required ratio', async function () {
      const { vault, owner, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
      const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n);
      await vault.connect(owner).setPriceFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 6);

      // 3200 USDC = $3200; 160% ratio -> need $5120 -> 1.6 ETH at $3200
      // Supply only 1.0 ETH = $3200 < $5120
      const principal = 3200n * 10n ** 6n;
      const insufficientCollateral = ethers.parseEther('1.0'); // $3200 < $5120 required
      await usdc.mint(lender.address, principal);
      await usdc.connect(lender).approve(await vault.getAddress(), principal);

      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: principal,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 13n,
        deadline: 9999999999n,
      };
      const sig = await signLendOffer(vault, lender, offer);
      await expect(
        vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: insufficientCollateral }),
      ).to.be.revertedWith('Collateral value below required ratio');
    });

    it('cancelSignedLendOffer: lender cancels, then fill reverts', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: 1000n * 10n ** 6n,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 20n,
        deadline: 9999999999n,
      };
      const digest = await vault.hashLendOffer(offer);
      await expect(vault.connect(lender).cancelSignedLendOffer(offer))
        .to.emit(vault, 'SignedLendOfferCancelled')
        .withArgs(digest, lender.address);
      const sig = await signLendOffer(vault, lender, offer);
      await expect(
        vault.connect(borrower).fillLendOffer(offer, ethers.ZeroAddress, 0n, sig, { value: ethers.parseEther('1') }),
      ).to.be.revertedWith('Signature already used');
    });

    it('cancelSignedLendOffer: reverts if caller is not lender', async function () {
      const { vault, lender, borrower } = await deployFixture();
      const Mock = await ethers.getContractFactory('MockERC20');
      const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
      const offer = {
        lender: lender.address,
        principalToken: await usdc.getAddress(),
        principalAmount: 1000n * 10n ** 6n,
        collateralRatioBps: RATIO,
        trustedRatioBps: TRUSTED,
        scoreThreshold: SCORE_THRESH,
        maxLtvBps: LTV,
        interestRateBps: RATE,
        durationSeconds: DURATION,
        nonce: 21n,
        deadline: 9999999999n,
      };
      await expect(vault.connect(borrower).cancelSignedLendOffer(offer)).to.be.revertedWith('Not signer');
    });
  });
});
