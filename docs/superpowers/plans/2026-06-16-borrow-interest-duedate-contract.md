# Borrow Interest Rate & Due Date — Contract Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `VouchVault` from flat interest to per-day (capped) APR, enforce a funding window, and let borrowers cancel unfunded loans and reclaim collateral.

**Architecture:** The `Loan` struct gains a `fundDeadline` (funding window cutoff) and `principalRepaid` (for interest-first amortization). `interestRateBps` is reinterpreted as an annual rate; interest accrues per whole day from `fundedAt`, capped at `fundedAt + durationSeconds`. Repayment applies to accrued interest first, then principal; collateral releases proportional to principal repaid. `fundLoan`/`fundLoanWithERC20` revert after `fundDeadline`. A new `cancelLoan` returns collateral on unfunded loans.

**Tech Stack:** Solidity ^0.8.24, OpenZeppelin upgradeable (UUPS), Hardhat, Mocha/Chai (TypeScript tests via `ethers` + `upgrades`).

**Scope note:** This is Plan 1 of 2. It covers ONLY the smart contract and its Hardhat tests — fully testable in isolation. Plan 2 (DB + API + Web integration) is written after this lands, because it depends on the regenerated ABI.

**Spec:** `docs/superpowers/specs/2026-06-15-borrow-interest-duedate-design.md`

---

## File Structure

- **Modify:** `packages/contracts/contracts/VouchVault.sol`
  - `Loan` struct: add `fundDeadline`, `principalRepaid` (appended — preserve storage layout).
  - `createLoan` / `createLoanWithERC20`: add `fundWindowSeconds` param; set `fundDeadline`.
  - New internal view `_accruedInterest(Loan memory) returns (uint256)`.
  - `repayLoan` / `repayLoanWithERC20`: interest-first amortization, principal-proportional collateral.
  - `fundLoan` / `fundLoanWithERC20`: revert past `fundDeadline`.
  - New `cancelLoan(uint256)` + `LoanCancelled` event.
  - `getRepaymentDetails`: return live accrued interest + `fundDeadline`.
- **Modify:** `packages/contracts/test/VouchVault.test.ts` — existing tests pass new `fundWindowSeconds` arg; new tests for accrual, cap, window, cancel, interest-first partials.
- **Regenerate (final task):** `packages/abi/VouchVault.json` (+ prod copy) via the contracts build.

**Interest math (canonical, used in contract and mirrored later in web):**
```
accruedInterest =
  funded == false                      -> 0
  durationSeconds == 0                 -> 0   (no deadline => no time-based accrual)
  else:
    cappedNow   = min(block.timestamp, fundedAt + durationSeconds)
    elapsedDays = (cappedNow - fundedAt) / 86400          // floor to whole days
    return principalAmount * interestRateBps * elapsedDays / (10000 * 365)
totalDue(now) = principalAmount + accruedInterest
```
`interestRateBps` is an **annual** rate in basis points (500 = 5% APR). 365-day year, simple interest, no compounding.

---

## Task 1: Extend the `Loan` struct (storage-safe)

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol:30-36`

- [ ] **Step 1: Append two fields to the `Loan` struct**

In `VouchVault.sol`, the struct currently ends (lines 30-36) with the V4 block. Append a V5 block AFTER `collateralReleased` so existing storage slots are preserved:

```solidity
        // V4 additions — appended to preserve storage layout
        uint16 interestRateBps;      // ANNUAL interest rate in basis points (e.g. 500 = 5% APR)
        uint256 durationSeconds;     // loan term in seconds (0 = no deadline / no time-based interest)
        bool repaid;                 // true once the loan has been fully repaid
        uint256 amountRepaid;        // cumulative debt repaid so far (principal token units)
        uint256 collateralReleased;  // cumulative collateral already returned to borrower
        // V5 additions — appended to preserve storage layout
        uint256 fundDeadline;        // absolute timestamp after which the loan can no longer be funded
        uint256 principalRepaid;     // cumulative principal repaid (interest-first amortization)
```

Note the comment change on `interestRateBps` from "simple interest rate" to "ANNUAL ... APR".

- [ ] **Step 2: Compile to confirm the struct change is valid**

Run: `cd packages/contracts && npx hardhat compile`
Expected: PASS — compiles. (Every `Loan({...})` initializer in `createLoan`/`createLoanWithERC20` will now error as "missing field" — that's expected and fixed in Task 2. If compile already errors on those initializers, proceed to Task 2 before re-compiling.)

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol
git commit -m "feat(contracts): add fundDeadline and principalRepaid to Loan struct"
```

---

## Task 2: Add `fundWindowSeconds` to loan creation + set `fundDeadline`

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol:114-201`
- Test: `packages/contracts/test/VouchVault.test.ts` (createLoan describe block, ~line 16)

- [ ] **Step 1: Update the failing test for `createLoan`**

The existing test at `test/VouchVault.test.ts:23` calls `createLoan(ZeroAddress, sentCollateral, 500, 86400, {value})`. Change that call to pass a fund window and assert the new struct field. Replace line 23 with:

```typescript
      const fundWindow = 7n * 86400n; // 7 days
      const tx = await vault.createLoan(ethers.ZeroAddress, sentCollateral, 500, 86400, fundWindow, { value: sentCollateral });
```

Then, after the existing `getLoan(0)` assertions (after line 47), add:

```typescript
      // fundDeadline = createdAt + fundWindow
      const created = await vault.loans(0);
      expect(created.fundDeadline).to.equal(created.createdAt + fundWindow);
      expect(created.principalRepaid).to.equal(0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && npx hardhat test --grep "Should create a loan with collateral"`
Expected: FAIL — `createLoan` currently takes 4 args, not 5 (argument count / encoding error).

- [ ] **Step 3: Add the param and set the struct fields in `createLoan`**

In `createLoan` (lines 119-154), change the signature and add the field initializers. New signature:

```solidity
    /// @param fundWindowSeconds Seconds from creation during which the loan may be funded (must be > 0)
    function createLoan(
        address principalToken,
        uint256 principalAmount,
        uint16 interestRateBps,
        uint256 durationSeconds,
        uint256 fundWindowSeconds
    ) external payable {
        require(msg.value > 0, "Collateral must be > 0");
        require(principalAmount > 0, "Principal amount must be > 0");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(fundWindowSeconds > 0, "Fund window must be > 0");
```

In the `Loan({...})` initializer, add the two new fields at the end (after `collateralReleased: 0`):

```solidity
            collateralReleased: 0,
            fundDeadline: block.timestamp + fundWindowSeconds,
            principalRepaid: 0
        });
```

- [ ] **Step 4: Apply the same change to `createLoanWithERC20`**

In `createLoanWithERC20` (lines 163-201), add `uint256 fundWindowSeconds` as the final param, add `require(fundWindowSeconds > 0, "Fund window must be > 0");` after the existing requires, and append the same two fields to its `Loan({...})` initializer:

```solidity
            collateralReleased: 0,
            fundDeadline: block.timestamp + fundWindowSeconds,
            principalRepaid: 0
        });
```

- [ ] **Step 5: Fix every other `createLoan*` call in the test file**

The test file calls `createLoan` / `createLoanWithERC20` in many places with the old arg count. Add a fund-window arg to each. Find them:

Run: `cd packages/contracts && grep -nE "createLoan\(|createLoanWithERC20\(" test/VouchVault.test.ts`

For each `createLoan(...)` call, insert `, 7n * 86400n` after the `durationSeconds` arg (the 4th positional arg) and before the `{ value }` options object. For each `createLoanWithERC20(...)` call, append `, 7n * 86400n` as the final arg. Example transforms:

```typescript
// before
await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 500, 86400, { value: collateral });
// after
await vault.connect(borrower).createLoan(ethers.ZeroAddress, principal, 500, 86400, 7n * 86400n, { value: collateral });

// before
await vault.createLoanWithERC20(await token.getAddress(), collateral, ethers.ZeroAddress, collateral, 0, 0);
// after
await vault.createLoanWithERC20(await token.getAddress(), collateral, ethers.ZeroAddress, collateral, 0, 0, 7n * 86400n);
```

- [ ] **Step 6: Run the full suite to verify creation tests pass**

Run: `cd packages/contracts && npx hardhat test --grep "createLoan"`
Expected: PASS — all createLoan / createLoanWithERC20 tests pass. (Other describe blocks may still fail because their calls were updated but downstream behavior changes in later tasks — that is fine; re-run the whole suite after Task 6.)

- [ ] **Step 7: Add a test that a zero fund window reverts**

In the `createLoan` describe block (after the "Should fail if collateral is zero" test, ~line 64), add:

```typescript
    it('Should fail if fund window is zero', async function () {
      const [owner] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('1.0');
      await expect(
        vault.createLoan(ethers.ZeroAddress, collateral, 0, 86400, 0, { value: collateral }),
      ).to.be.revertedWith('Fund window must be > 0');
    });
```

- [ ] **Step 8: Run the new test**

Run: `cd packages/contracts && npx hardhat test --grep "Should fail if fund window is zero"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add fundWindowSeconds param and set fundDeadline on creation"
```

---

## Task 3: Add `_accruedInterest` helper and rewrite `getRepaymentDetails`

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol:458-477`
- Test: `packages/contracts/test/VouchVault.test.ts`

- [ ] **Step 1: Write a failing test for per-day accrued interest**

Add a new describe block to `test/VouchVault.test.ts` (place it before the closing `});` of the top-level `describe('VouchVault', ...)`). It funds a loan, advances time, and checks `getRepaymentDetails` reflects per-day APR:

```typescript
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
      // totalDue right after funding (0 whole days elapsed) == principal
      expect(details[3]).to.equal(principal);
    });

    it('accrues per whole day at the annual rate', async function () {
      // 3650 bps = 36.5% APR; over 10 days on principal 1 ETH:
      // interest = 1e18 * 3650 * 10 / (10000 * 365) = 1e18 * 0.1 = 0.1 ETH
      const { vault, principal } = await deployFunded(3650, 30n * 86400n);
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const details = await vault.getRepaymentDetails(0);
      const expectedInterest = (principal * 3650n * 10n) / (10000n * 365n);
      expect(details[3]).to.equal(principal + expectedInterest); // totalDue
    });

    it('caps interest at the loan duration', async function () {
      const { vault, principal } = await deployFunded(3650, 5n * 86400n); // 5-day term
      await ethers.provider.send('evm_increaseTime', [100 * 86400]); // way past due
      await ethers.provider.send('evm_mine', []);
      const details = await vault.getRepaymentDetails(0);
      const cappedInterest = (principal * 3650n * 5n) / (10000n * 365n); // capped at 5 days
      expect(details[3]).to.equal(principal + cappedInterest);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && npx hardhat test --grep "accrued interest"`
Expected: FAIL — `getRepaymentDetails` still uses flat interest, so `totalDue` won't match per-day expectations.

- [ ] **Step 3: Add the `_accruedInterest` internal view**

In `VouchVault.sol`, in the `// --- View Functions ---` section (before `getRepaymentDetails`, ~line 449), add:

```solidity
    /// @notice Per-day simple interest accrued so far, capped at the loan duration.
    /// @dev Annual rate; 365-day year; floors elapsed time to whole days. Zero if unfunded or no duration.
    function _accruedInterest(Loan memory loan) internal view returns (uint256) {
        if (!loan.funded || loan.durationSeconds == 0) return 0;
        uint256 dueAt = loan.fundedAt + loan.durationSeconds;
        uint256 cappedNow = block.timestamp < dueAt ? block.timestamp : dueAt;
        uint256 elapsedDays = (cappedNow - loan.fundedAt) / 86400;
        return (loan.principalAmount * loan.interestRateBps * elapsedDays) / (10000 * 365);
    }
```

- [ ] **Step 4: Rewrite `getRepaymentDetails` to use live accrual**

Replace the body of `getRepaymentDetails` (lines 466-476) so `totalDue` uses `_accruedInterest` and add `fundDeadline` to the return tuple. New version:

```solidity
    /**
     * @notice Returns repayment-related details for a loan.
     * @return interestRateBps  Agreed ANNUAL interest rate in basis points.
     * @return durationSeconds  Agreed loan duration in seconds (0 = no deadline).
     * @return repaid           Whether the loan has been fully repaid.
     * @return totalDue         Principal + accrued interest owed right now (0 if not funded).
     * @return amountRepaid     Cumulative amount repaid so far.
     * @return remaining        Amount still outstanding right now.
     * @return fundDeadline     Timestamp after which the loan can no longer be funded.
     */
    function getRepaymentDetails(uint256 loanId) external view returns (
        uint16 interestRateBps,
        uint256 durationSeconds,
        bool repaid,
        uint256 totalDue,
        uint256 amountRepaid,
        uint256 remaining,
        uint256 fundDeadline
    ) {
        Loan memory loan = loans[loanId];
        uint256 due = loan.funded ? loan.principalAmount + _accruedInterest(loan) : 0;
        return (
            loan.interestRateBps,
            loan.durationSeconds,
            loan.repaid,
            due,
            loan.amountRepaid,
            due > loan.amountRepaid ? due - loan.amountRepaid : 0,
            loan.fundDeadline
        );
    }
```

- [ ] **Step 5: Update the createLoan test's repaymentDetails assertions for the new 7th return value**

The `createLoan` test (test lines 49-55) reads `getRepaymentDetails(0)`. It still works for indices 0-5, but add an assertion for the new index 6. After line 55 add:

```typescript
      expect(repaymentDetails[6]).to.equal(created.fundDeadline); // fundDeadline
```

Note: `created` is the `vault.loans(0)` result added in Task 2 Step 1. If that test reads `getRepaymentDetails` before `created` is defined, move the `const created = await vault.loans(0);` line above the `getRepaymentDetails` call.

- [ ] **Step 6: Run accrual + createLoan tests**

Run: `cd packages/contracts && npx hardhat test --grep "accrued interest|Should create a loan with collateral"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): per-day capped APR accrual via _accruedInterest + getRepaymentDetails"
```

---

## Task 4: Interest-first amortization in `repayLoan` (ETH principal)

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol:228-279`
- Test: `packages/contracts/test/VouchVault.test.ts` (repayLoan describe, ~line 289)

- [ ] **Step 1: Write a failing test for interest-first partial repayment**

Add to the `describe('repayLoan (ETH principal)', ...)` block (the existing `deployFundedLoan` helper at ~line 290 uses a 1-day duration `86400`; we need accrued interest, so add a dedicated test that advances time). Insert this test inside that describe block:

```typescript
    it('applies partial payment to interest first, releases collateral by principal', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      // 3650 bps APR, 30-day term
      await vault
        .connect(borrower)
        .createLoan(ethers.ZeroAddress, principal, 3650, 30n * 86400n, 7n * 86400n, { value: collateral });
      await vault.connect(lender).fundLoan(0, { value: principal });

      // Advance 10 days => interest = 1e18 * 3650 * 10 / (10000*365) = 0.1 ETH
      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const interest = (principal * 3650n * 10n) / (10000n * 365n);

      // Pay exactly the accrued interest: principalRepaid stays 0, no collateral released
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/contracts && npx hardhat test --grep "applies partial payment to interest first|full repayment after accrual"`
Expected: FAIL — current `repayLoan` uses flat `totalDue` and releases collateral proportional to payment, not principal.

- [ ] **Step 3: Rewrite `repayLoan` for interest-first amortization**

Replace the entire `repayLoan` function (lines 228-279) with this exact implementation. The guards (lines 230-235) are unchanged; everything from the `totalDue` computation onward is rewritten:

```solidity
    function repayLoan(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(!loan.repaid, "Loan already repaid");
        require(loan.active, "Loan is not active");
        require(loan.funded, "Loan is not funded");
        require(msg.sender == loan.borrower, "Only borrower can repay");
        require(loan.requestedPrincipalToken == address(0), "Loan has ERC20 principal; use repayLoanWithERC20");
        require(msg.value > 0, "Payment must be > 0");

        uint256 accrued = _accruedInterest(loan);
        uint256 totalDue = loan.principalAmount + accrued;
        uint256 remaining = totalDue - loan.amountRepaid;
        require(msg.value <= remaining, "Payment exceeds amount owed");

        loan.amountRepaid += msg.value;

        // Interest-first: interest paid so far = min(amountRepaid, accrued); the rest is principal.
        uint256 interestPaid = loan.amountRepaid < accrued ? loan.amountRepaid : accrued;
        uint256 newPrincipalRepaid = loan.amountRepaid - interestPaid;
        uint256 principalDelta = newPrincipalRepaid - loan.principalRepaid;
        loan.principalRepaid = newPrincipalRepaid;

        bool fullRepayment = loan.amountRepaid == totalDue;

        // Collateral released proportional to principal repaid; final payment returns the dust.
        uint256 collateralToRelease = fullRepayment
            ? loan.collateralAmount - loan.collateralReleased
            : (loan.collateralAmount * principalDelta) / loan.principalAmount;

        loan.collateralReleased += collateralToRelease;

        if (fullRepayment) {
            loan.repaid = true;
            loan.active = false;
            loan.collateralLocked = false;
        }

        (bool lenderOk, ) = payable(loan.lender).call{value: msg.value}("");
        require(lenderOk, "ETH transfer to lender failed");

        if (collateralToRelease > 0) {
            if (loan.collateralToken == address(0)) {
                lockedEthCollateral[loan.borrower] -= collateralToRelease;
                (bool borrowerOk, ) = payable(loan.borrower).call{value: collateralToRelease}("");
                require(borrowerOk, "ETH collateral return failed");
            } else {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, collateralToRelease);
            }
        }

        if (fullRepayment) {
            emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.principalAmount, accrued, totalDue, block.timestamp);
        } else {
            emit LoanPartiallyRepaid(loanId, loan.borrower, msg.value, collateralToRelease, loan.amountRepaid, totalDue, block.timestamp);
        }
    }
```

- [ ] **Step 4: Run repay tests**

Run: `cd packages/contracts && npx hardhat test --grep "repayLoan"`
Expected: PASS for the two new tests. Some pre-existing flat-interest partial-repayment tests (test lines ~427-543) assume proportional-to-payment collateral release on zero-interest loans — with `interestRateBps = 0`, `accrued = 0`, so `interestPaid = 0` and `principalDelta == msg.value`, making release `collateralAmount * msg.value / principal`. For zero-interest loans `principalAmount == totalDue`, so behavior is identical to before and those tests should still pass. If any fail, inspect whether they used a nonzero rate with a flat expectation and update the expectation to the per-day model.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): interest-first amortization for repayLoan (ETH principal)"
```

---

## Task 5: Mirror interest-first amortization in `repayLoanWithERC20`

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol:293-340`
- Test: `packages/contracts/test/VouchVault.test.ts`

- [ ] **Step 1: Write a failing test for ERC20 interest-first repayment**

Find the ERC20 repay describe block (search `grep -n "repayLoanWithERC20" test/VouchVault.test.ts`). Add a test that mirrors Task 4's full-repayment-after-accrual using ERC20 principal. Use the existing ERC20 setup pattern in that file (it deploys a `MockERC20` and approves the vault). Add inside the ERC20 repay describe:

```typescript
    it('ERC20: full repayment after accrual closes loan and returns collateral', async function () {
      const [owner, borrower, lender] = await ethers.getSigners();
      const VouchVault = await ethers.getContractFactory('VouchVault');
      const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
      const Token = await ethers.getContractFactory('MockERC20');
      const token = await Token.deploy('Mock', 'MOCK');
      const collateral = ethers.parseEther('5.0');
      const principal = ethers.parseEther('1.0');
      // 3650 bps APR, 30-day term, ERC20 principal
      await vault
        .connect(borrower)
        .createLoan(await token.getAddress(), principal, 3650, 30n * 86400n, 7n * 86400n, { value: collateral });
      // lender funds with ERC20
      await token.mint(lender.address, principal);
      await token.connect(lender).approve(await vault.getAddress(), principal);
      await vault.connect(lender).fundLoanWithERC20(0, await token.getAddress(), principal);

      await ethers.provider.send('evm_increaseTime', [10 * 86400]);
      await ethers.provider.send('evm_mine', []);
      const interest = (principal * 3650n * 10n) / (10000n * 365n);
      const totalDue = principal + interest;

      // borrower needs tokens to repay principal + interest
      await token.mint(borrower.address, totalDue);
      await token.connect(borrower).approve(await vault.getAddress(), totalDue);
      await vault.connect(borrower).repayLoanWithERC20(0, totalDue);

      const loan = await vault.loans(0);
      expect(loan.repaid).to.equal(true);
      expect(loan.principalRepaid).to.equal(principal);
      expect(loan.collateralReleased).to.equal(collateral);
    });
```

If the file's MockERC20 constructor signature or mint helper differs, match the existing usage in the file (search `MockERC20` and `.mint(` to confirm).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/contracts && npx hardhat test --grep "ERC20: full repayment after accrual"`
Expected: FAIL — `repayLoanWithERC20` still uses flat interest.

- [ ] **Step 3: Apply the same amortization rewrite to `repayLoanWithERC20`**

In `repayLoanWithERC20` (lines 293-340), keep the signature and the existing guards (lines 295-300), then replace the math/collateral/transfer block with the interest-first version (parallel to Task 4, but the payment variable is `amount` not `msg.value`, and principal goes to the lender via `safeTransferFrom`):

```solidity
        uint256 accrued = _accruedInterest(loan);
        uint256 totalDue = loan.principalAmount + accrued;
        uint256 remaining = totalDue - loan.amountRepaid;
        require(amount <= remaining, "Payment exceeds amount owed");

        loan.amountRepaid += amount;

        uint256 interestPaid = loan.amountRepaid < accrued ? loan.amountRepaid : accrued;
        uint256 newPrincipalRepaid = loan.amountRepaid - interestPaid;
        uint256 principalDelta = newPrincipalRepaid - loan.principalRepaid;
        loan.principalRepaid = newPrincipalRepaid;

        bool fullRepayment = loan.amountRepaid == totalDue;

        uint256 collateralToRelease = fullRepayment
            ? loan.collateralAmount - loan.collateralReleased
            : (loan.collateralAmount * principalDelta) / loan.principalAmount;

        loan.collateralReleased += collateralToRelease;

        if (fullRepayment) {
            loan.repaid = true;
            loan.active = false;
            loan.collateralLocked = false;
        }

        IERC20(loan.requestedPrincipalToken).safeTransferFrom(msg.sender, loan.lender, amount);

        if (collateralToRelease > 0) {
            if (loan.collateralToken == address(0)) {
                lockedEthCollateral[loan.borrower] -= collateralToRelease;
                (bool ok, ) = payable(loan.borrower).call{value: collateralToRelease}("");
                require(ok, "ETH collateral return failed");
            } else {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, collateralToRelease);
            }
        }

        if (fullRepayment) {
            emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.principalAmount, accrued, totalDue, block.timestamp);
        } else {
            emit LoanPartiallyRepaid(loanId, loan.borrower, amount, collateralToRelease, loan.amountRepaid, totalDue, block.timestamp);
        }
```

- [ ] **Step 4: Run ERC20 repay tests**

Run: `cd packages/contracts && npx hardhat test --grep "repayLoanWithERC20|ERC20: full repayment"`
Expected: PASS (with the same zero-interest-equivalence reasoning as Task 4 for pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): interest-first amortization for repayLoanWithERC20"
```

---

## Task 6: Enforce the funding window in `fundLoan` / `fundLoanWithERC20`

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol:360-403`
- Test: `packages/contracts/test/VouchVault.test.ts` (fundLoan describe, ~line 129)

- [ ] **Step 1: Write a failing test for funding past the deadline**

Add to the `describe('fundLoan', ...)` block:

```typescript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/contracts && npx hardhat test --grep "reverts when funding after the fund window"`
Expected: FAIL — no window check yet.

- [ ] **Step 3: Add the window guard to both fund functions**

In `fundLoan` (after line 364's borrower check, before transferring), add:

```solidity
        require(block.timestamp <= loan.fundDeadline, "Funding window passed");
```

In `fundLoanWithERC20` (after line 388's borrower check), add the identical line.

- [ ] **Step 4: Run fund tests**

Run: `cd packages/contracts && npx hardhat test --grep "fundLoan"`
Expected: PASS — new test passes, existing fund tests still pass (they fund immediately, well within the 7-day window the test setup now uses).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): block funding after the fund window deadline"
```

---

## Task 7: Add `cancelLoan` + `LoanCancelled` event

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol` (event near line 84; function near the create functions)
- Test: `packages/contracts/test/VouchVault.test.ts`

- [ ] **Step 1: Write failing tests for cancel**

Add a new describe block to `test/VouchVault.test.ts`:

```typescript
  describe('cancelLoan', function () {
    async function deployUnfunded(collateralIsErc20 = false) {
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
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/contracts && npx hardhat test --grep "cancelLoan"`
Expected: FAIL — `cancelLoan` / `LoanCancelled` don't exist.

- [ ] **Step 3: Add the `LoanCancelled` event**

After the `LoanPartiallyRepaid` event (line 84), add:

```solidity
    event LoanCancelled(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 timestamp
    );
```

- [ ] **Step 4: Add the `cancelLoan` function**

Add after `createLoanWithERC20` (after line 201):

```solidity
    /// @notice Cancel an unfunded loan and return locked collateral to the borrower.
    /// @dev Callable any time before the loan is funded. Returns collateral in its original form.
    function cancelLoan(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(msg.sender == loan.borrower, "Only borrower can cancel");
        require(!loan.funded, "Cannot cancel a funded loan");

        uint256 amount = loan.collateralAmount - loan.collateralReleased;

        loan.active = false;
        loan.collateralLocked = false;
        loan.collateralReleased = loan.collateralAmount;

        if (amount > 0) {
            if (loan.collateralToken == address(0)) {
                lockedEthCollateral[loan.borrower] -= amount;
                (bool ok, ) = payable(loan.borrower).call{value: amount}("");
                require(ok, "ETH collateral return failed");
            } else {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, amount);
            }
        }

        emit LoanCancelled(loanId, loan.borrower, block.timestamp);
    }
```

- [ ] **Step 5: Run cancel tests**

Run: `cd packages/contracts && npx hardhat test --grep "cancelLoan"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add cancelLoan for unfunded loans with LoanCancelled event"
```

---

## Task 8: Full suite green + regenerate ABI

**Files:**
- Modify (generated): `packages/abi/VouchVault.json`, `packages/abi/prod/VouchVault.json`

- [ ] **Step 1: Run the entire contract test suite**

Run: `cd packages/contracts && npx hardhat test`
Expected: PASS — all tests green. If any pre-existing test still assumes flat interest with a nonzero rate, update its expected value to the per-day model (`interest = principal * bps * elapsedDays / (10000*365)`, capped at duration). Do not weaken assertions — fix the expected numbers.

- [ ] **Step 2: Compile / regenerate the ABI**

Determine how the ABI JSONs are produced. Run: `cd packages/contracts && cat package.json` and look for a script that copies artifacts to `packages/abi` (e.g. `build`, `export-abi`, or a postcompile step). Run that script. If none exists, copy the compiled ABI:

Run: `cd packages/contracts && npx hardhat compile`
Then locate the artifact `artifacts/contracts/VouchVault.sol/VouchVault.json` and update `packages/abi/VouchVault.json` (and `packages/abi/prod/VouchVault.json`) using whatever mechanism the repo already uses (confirm by `git log --oneline -- ../abi/VouchVault.json` to see how it was last updated). The ABI MUST now include `cancelLoan`, `LoanCancelled`, the 7-tuple `getRepaymentDetails`, and the new `fundWindowSeconds` params.

- [ ] **Step 3: Verify the ABI contains the new surface**

Run: `cd packages/contracts && grep -E "cancelLoan|LoanCancelled|fundDeadline" ../abi/VouchVault.json`
Expected: matches found for `cancelLoan` and `LoanCancelled` (and `fundDeadline` appears in the `getRepaymentDetails` outputs).

- [ ] **Step 4: Commit**

```bash
git add packages/abi/VouchVault.json packages/abi/prod/VouchVault.json
git commit -m "chore(abi): regenerate VouchVault ABI for APR, fund window, and cancel"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** APR per-day capped accrual (Tasks 3-5) ✓; duration enforced via accrual cap (Task 3) ✓; fund window + `fundDeadline` (Tasks 2, 6) ✓; block late funding on-chain (Task 6) ✓; borrower cancel anytime before funding (Task 7) ✓; interest-first amortization / Approach A with partial payments (Tasks 4-5) ✓; `getRepaymentDetails` exposes accrued interest + fundDeadline for the off-chain layer (Task 3) ✓. Storage-layout safety for the upgradeable contract (Task 1, append-only) ✓.
- **Out of scope (correctly deferred to Plan 2):** DB columns, RPCs, API DTOs, web form, marketplace filter, `vouchVault.ts` wrappers, `loanMath.ts`. These need the regenerated ABI from Task 8.
- **Type/signature consistency:** `_accruedInterest(Loan memory)` used identically in Tasks 3-5; `getRepaymentDetails` 7-tuple updated in Task 3 and asserted in Task 3 Step 5; `fundWindowSeconds` is the 5th arg of `createLoan` and final arg of `createLoanWithERC20` consistently across tests.
- **Known follow-up for Plan 2:** the web `getRepaymentDetails` reader in `apps/web/src/lib/wallet/vouchVault.ts:110-121` destructures a 6-tuple and must be widened to 7 (add `fundDeadline`). This is a Plan 2 task but is noted here so it is not lost.

---

## Plan 2 preview (NOT part of this plan)

After this lands, Plan 2 covers: migration adding `fundDeadline` + repurposing `duration`/`interestRate`; `create_loan_with_transaction` / `fund_loan_with_transaction` / new `cancel_loan_with_transaction` RPCs; `CreateLoanDto` + cancel endpoint + marketplace filter (`status='pending' AND fundDeadline > now()`); `CreateLoan.svelte` inputs (APR, duration preset+custom, fund-window preset+custom); `vouchVault.ts` (stop hardcoding `0,0`, add `cancelLoan` wrapper, widen `getRepaymentDetails`); `loanMath.ts` per-day accrual helper; loan-card display + cancel button.
