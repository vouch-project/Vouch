# Lend Offer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-chain lend offers to VouchVault — lenders lock principal in the contract, borrowers accept by posting collateral, producing an active `Loan` via the existing lifecycle.

**Architecture:** New `LendOffer` struct and four function pairs (ETH + ERC20 variants) added to `VouchVault.sol`. API listens to four new events and syncs them to a new `lend_offers` Supabase table via stored procedures. Frontend replaces the `/lend` stub with a creation form and adds a Lend Offers tab to `/marketplace`.

**Tech Stack:** Solidity 0.8.24 (UUPS upgradeable), Hardhat + Chai tests, NestJS (class-validator DTOs), Supabase PostgreSQL (plpgsql stored procedures), SvelteKit 5 (runes), ethers v6, shadcn-svelte, Tailwind CSS.

## Global Constraints

- Solidity version must stay `^0.8.24`; contract is UUPS upgradeable — never add `constructor` storage; extend `initialize` or use new state variables appended to the bottom
- `LendOffer` struct must be added as a new storage mapping (`lendOffers`) — do not alter the existing `Loan` struct field ordering (breaks storage layout)
- `lendOfferId` field on `Loan` must be appended at the very end of the struct
- All token amounts stored/passed as `text` in Postgres (BigInt safety)
- Supabase column names follow camelCase convention (existing schema uses `"onChainLoanId"`, `"chainId"`, etc.)
- Migration filenames: `YYYYMMDDHHMMSS_<description>.sql`; use timestamp `20260818000000` through `20260818000004`
- NestJS DTOs live in `apps/api/src/loans/dto/`; use `@IsBigInt()` from `../../decorators/is-bigint.decorator` for `bigint` fields
- Frontend imports theme colors only (`bg-background`, `text-foreground`, etc.) — no hardcoded Tailwind color values
- `npx hardhat test` must pass after Task 1; `pnpm test` in `apps/api` after Task 3; frontend type-check (`pnpm check`) after Task 5

---

## File Map

| Status | File | Change |
|--------|------|--------|
| Modify | `packages/contracts/contracts/VouchVault.sol` | Add `LendOffer` struct, state vars, 6 functions, 4 events, `lendOfferId` on `Loan` |
| Modify | `packages/contracts/test/VouchVault.test.ts` | Add lend offer test suite |
| Create | `supabase/migrations/20260818000000_lend_offer_enum.sql` | `lendOfferStatus` ENUM |
| Create | `supabase/migrations/20260818000001_lend_offers_table.sql` | `lend_offers` table + indexes |
| Create | `supabase/migrations/20260818000002_loans_lend_offer_fk.sql` | `lend_offer_id` column on `loans` |
| Create | `supabase/migrations/20260818000003_create_lend_offer_with_transaction.sql` | Stored procedure |
| Create | `supabase/migrations/20260818000004_accept_lend_offer_with_transaction.sql` | Stored procedure |
| Create | `supabase/migrations/20260818000005_cancel_lend_offer_with_transaction.sql` | Stored procedure |
| Create | `supabase/migrations/20260818000006_expire_lend_offer_with_transaction.sql` | Stored procedure |
| Create | `apps/api/src/loans/dto/create-lend-offer.dto.ts` | DTO |
| Create | `apps/api/src/loans/dto/accept-lend-offer.dto.ts` | DTO |
| Create | `apps/api/src/loans/dto/cancel-lend-offer.dto.ts` | DTO |
| Create | `apps/api/src/loans/dto/expire-lend-offer.dto.ts` | DTO |
| Modify | `apps/api/src/loans/loans.service.ts` | Add 4 service methods |
| Modify | `apps/api/src/blockchain-listener/blockchain-listener.service.ts` | Add 4 event listeners + handlers |
| Modify | `apps/web/src/lib/wallet/vouchVault.ts` | Add `createLendOffer`, `acceptLendOffer`, `cancelLendOffer` wallet functions |
| Modify | `apps/web/src/routes/lend/+page.svelte` | Replace stub with `CreateLendOffer` form component |
| Create | `apps/web/src/lib/components/ui/CreateLendOffer.svelte` | Lend offer creation form |
| Modify | `apps/web/src/routes/marketplace/+page.svelte` | Add Lend Offers tab |
| Modify | `apps/web/src/routes/dashboard/+page.svelte` | Add lender's offers section |

---

### Task 1: Smart Contract — LendOffer struct, state, events, and functions

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol`
- Test: `packages/contracts/test/VouchVault.test.ts`

**Interfaces:**
- Produces: `lendOffers(uint256) → LendOffer`, `nextLendOfferId`, events `LendOfferCreated(offerId, lender, principalToken, principalAmount)`, `LendOfferAccepted(offerId, loanId, borrower)`, `LendOfferCancelled(offerId, lender)`, `LendOfferExpired(offerId)`
- Produces: functions `createLendOffer(collateralToken, minCollateral, maxLtvBps, rateBps, durationSeconds, acceptWindowSeconds) payable`, `createLendOfferWithERC20(principalToken, principalAmount, collateralToken, minCollateral, maxLtvBps, rateBps, durationSeconds, acceptWindowSeconds)`, `acceptLendOffer(offerId) payable`, `acceptLendOfferWithERC20(offerId, collateralAmount)`, `cancelLendOffer(offerId)`, `expireLendOffer(offerId)`

- [ ] **Step 1: Write failing tests for `createLendOffer` (ETH principal)**

Add a new `describe('lendOffer')` block to `packages/contracts/test/VouchVault.test.ts`:

```typescript
describe('lendOffer', function () {
  async function deployFixture() {
    const [owner, lender, borrower] = await ethers.getSigners();
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
    return { vault, owner, lender, borrower };
  }

  it('createLendOffer: locks ETH principal, emits LendOfferCreated', async function () {
    const { vault, lender } = await deployFixture();
    const principal = ethers.parseEther('1.0');
    const tx = await vault.connect(lender).createLendOffer(
      ethers.ZeroAddress,   // requiredCollateralToken (ETH)
      ethers.parseEther('1.5'), // minCollateral
      6500,                 // maxLtvBps
      800,                  // rateBps
      30n * 86400n,         // durationSeconds
      7n * 86400n,          // acceptWindowSeconds
      { value: principal },
    );
    await expect(tx)
      .to.emit(vault, 'LendOfferCreated')
      .withArgs(0, lender.address, ethers.ZeroAddress, principal);

    const offer = await vault.lendOffers(0);
    expect(offer.lender).to.equal(lender.address);
    expect(offer.principalAmount).to.equal(principal);
    expect(offer.active).to.equal(true);
    expect(offer.accepted).to.equal(false);
  });

  it('createLendOffer: reverts if msg.value is 0', async function () {
    const { vault, lender } = await deployFixture();
    await expect(
      vault.connect(lender).createLendOffer(ethers.ZeroAddress, ethers.parseEther('1.5'), 6500, 800, 30n * 86400n, 7n * 86400n, { value: 0 }),
    ).to.be.revertedWith('Principal must be > 0');
  });

  it('acceptLendOffer: borrower posts ETH collateral, creates loan, emits LendOfferAccepted', async function () {
    const { vault, lender, borrower } = await deployFixture();
    const principal = ethers.parseEther('1.0');
    const collateral = ethers.parseEther('1.6');
    await vault.connect(lender).createLendOffer(
      ethers.ZeroAddress, ethers.parseEther('1.5'), 6500, 800, 30n * 86400n, 7n * 86400n, { value: principal },
    );
    const tx = await vault.connect(borrower).acceptLendOffer(0, { value: collateral });
    await expect(tx).to.emit(vault, 'LendOfferAccepted').withArgs(0, 0, borrower.address);

    const offer = await vault.lendOffers(0);
    expect(offer.accepted).to.equal(true);
    expect(offer.acceptedLoanId).to.equal(0);

    const loan = await vault.loans(0);
    expect(loan.borrower).to.equal(borrower.address);
    expect(loan.lender).to.equal(lender.address);
    expect(loan.funded).to.equal(true);
    expect(loan.lendOfferId).to.equal(0);
  });

  it('acceptLendOffer: reverts if collateral below minCollateralAmount', async function () {
    const { vault, lender, borrower } = await deployFixture();
    const principal = ethers.parseEther('1.0');
    await vault.connect(lender).createLendOffer(
      ethers.ZeroAddress, ethers.parseEther('1.5'), 6500, 800, 30n * 86400n, 7n * 86400n, { value: principal },
    );
    await expect(
      vault.connect(borrower).acceptLendOffer(0, { value: ethers.parseEther('1.0') }),
    ).to.be.revertedWith('Collateral below minimum');
  });

  it('cancelLendOffer: lender reclaims ETH principal, emits LendOfferCancelled', async function () {
    const { vault, lender } = await deployFixture();
    const principal = ethers.parseEther('1.0');
    await vault.connect(lender).createLendOffer(
      ethers.ZeroAddress, ethers.parseEther('1.5'), 6500, 800, 30n * 86400n, 7n * 86400n, { value: principal },
    );
    const balBefore = await ethers.provider.getBalance(lender.address);
    const tx = await vault.connect(lender).cancelLendOffer(0);
    await expect(tx).to.emit(vault, 'LendOfferCancelled').withArgs(0, lender.address);
    const offer = await vault.lendOffers(0);
    expect(offer.active).to.equal(false);
    const balAfter = await ethers.provider.getBalance(lender.address);
    expect(balAfter).to.be.gt(balBefore); // got refund (minus gas)
  });

  it('expireLendOffer: permissionless after acceptDeadline, returns ETH principal', async function () {
    const { vault, lender, borrower } = await deployFixture();
    const principal = ethers.parseEther('1.0');
    await vault.connect(lender).createLendOffer(
      ethers.ZeroAddress, ethers.parseEther('1.5'), 6500, 800, 30n * 86400n, 1n, // 1s window
      { value: principal },
    );
    // advance time past acceptDeadline
    await ethers.provider.send('evm_increaseTime', [10]);
    await ethers.provider.send('evm_mine', []);
    const tx = await vault.connect(borrower).expireLendOffer(0);
    await expect(tx).to.emit(vault, 'LendOfferExpired').withArgs(0);
    const offer = await vault.lendOffers(0);
    expect(offer.active).to.equal(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/contracts && npx hardhat test test/VouchVault.test.ts --grep "lendOffer"
```

Expected: multiple failures — `vault.createLendOffer is not a function` / `vault.lendOffers is not a function`.

- [ ] **Step 3: Add `LendOffer` struct, storage, and events to VouchVault.sol**

In `packages/contracts/contracts/VouchVault.sol`:

After the `Loan` struct (around line 47), add `lendOfferId` as the **last field** of `Loan`:

```solidity
        // Lend offer link
        uint256 lendOfferId;   // 0 = borrow-initiated; set to the LendOffer id when created via acceptLendOffer
```

After the `Loan` struct closing brace, add the new struct:

```solidity
    struct LendOffer {
        address lender;
        address principalToken;              // address(0) = native ETH
        uint256 principalAmount;
        address requiredCollateralToken;     // address(0) = native ETH
        uint256 minCollateralAmount;
        uint16  maxLtvBps;
        uint16  interestRateBps;
        uint256 durationSeconds;
        uint256 acceptDeadline;
        bool    active;
        bool    accepted;
        uint256 acceptedLoanId;
    }
```

After `uint256 public nextLoanId;` in the state variables section, add:

```solidity
    mapping(uint256 => LendOffer) public lendOffers;
    uint256 public nextLendOfferId;
```

After the existing `LoanLiquidated` / `LiquidationBonusUpdated` events, add:

```solidity
    event LendOfferCreated(
        uint256 indexed offerId,
        address indexed lender,
        address principalToken,
        uint256 principalAmount
    );
    event LendOfferAccepted(
        uint256 indexed offerId,
        uint256 indexed loanId,
        address indexed borrower
    );
    event LendOfferCancelled(uint256 indexed offerId, address indexed lender);
    event LendOfferExpired(uint256 indexed offerId);
```

- [ ] **Step 4: Implement `createLendOffer` (ETH principal)**

Add after `expireLoan` in the Logic Functions section:

```solidity
    /// @notice Create a lend offer by depositing ETH as principal.
    /// @param requiredCollateralToken  Token borrower must post as collateral (address(0) = ETH)
    /// @param minCollateralAmount      Minimum collateral the borrower must post
    /// @param maxLtvBps                Maximum LTV accepted (e.g. 6500 = 65%), in basis points
    /// @param interestRateBps          Annual interest rate in basis points the lender demands
    /// @param durationSeconds          Loan term in seconds
    /// @param acceptWindowSeconds      Seconds from now within which the offer may be accepted (must be > 0)
    function createLendOffer(
        address requiredCollateralToken,
        uint256 minCollateralAmount,
        uint16  maxLtvBps,
        uint16  interestRateBps,
        uint256 durationSeconds,
        uint256 acceptWindowSeconds
    ) external payable {
        require(msg.value > 0, "Principal must be > 0");
        require(minCollateralAmount > 0, "Min collateral must be > 0");
        require(maxLtvBps > 0 && maxLtvBps <= 10000, "Invalid maxLtvBps");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(acceptWindowSeconds > 0, "Accept window must be > 0");

        lendOffers[nextLendOfferId] = LendOffer({
            lender: msg.sender,
            principalToken: address(0),
            principalAmount: msg.value,
            requiredCollateralToken: requiredCollateralToken,
            minCollateralAmount: minCollateralAmount,
            maxLtvBps: maxLtvBps,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            acceptDeadline: block.timestamp + acceptWindowSeconds,
            active: true,
            accepted: false,
            acceptedLoanId: 0
        });

        emit LendOfferCreated(nextLendOfferId, msg.sender, address(0), msg.value);
        nextLendOfferId++;
    }
```

- [ ] **Step 5: Implement `createLendOfferWithERC20`**

```solidity
    /// @notice Create a lend offer by depositing an ERC20 token as principal.
    function createLendOfferWithERC20(
        address principalToken,
        uint256 principalAmount,
        address requiredCollateralToken,
        uint256 minCollateralAmount,
        uint16  maxLtvBps,
        uint16  interestRateBps,
        uint256 durationSeconds,
        uint256 acceptWindowSeconds
    ) external {
        require(principalToken != address(0), "Invalid principal token");
        require(principalAmount > 0, "Principal must be > 0");
        require(minCollateralAmount > 0, "Min collateral must be > 0");
        require(maxLtvBps > 0 && maxLtvBps <= 10000, "Invalid maxLtvBps");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(acceptWindowSeconds > 0, "Accept window must be > 0");

        uint256 balanceBefore = IERC20(principalToken).balanceOf(address(this));
        IERC20(principalToken).safeTransferFrom(msg.sender, address(this), principalAmount);
        uint256 received = IERC20(principalToken).balanceOf(address(this)) - balanceBefore;
        require(received == principalAmount, "Fee-on-transfer principal not supported");

        lendOffers[nextLendOfferId] = LendOffer({
            lender: msg.sender,
            principalToken: principalToken,
            principalAmount: principalAmount,
            requiredCollateralToken: requiredCollateralToken,
            minCollateralAmount: minCollateralAmount,
            maxLtvBps: maxLtvBps,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            acceptDeadline: block.timestamp + acceptWindowSeconds,
            active: true,
            accepted: false,
            acceptedLoanId: 0
        });

        emit LendOfferCreated(nextLendOfferId, msg.sender, principalToken, principalAmount);
        nextLendOfferId++;
    }
```

- [ ] **Step 6: Implement `acceptLendOffer` (ETH collateral) and internal `_createLoanFromOffer`**

```solidity
    /// @dev Internal helper: create a Loan record from an accepted LendOffer.
    ///      The loan starts funded (lender + principal already set).
    function _createLoanFromOffer(
        uint256 offerId,
        LendOffer storage offer,
        address collateralToken,
        uint256 collateralAmount
    ) internal returns (uint256 loanId) {
        loanId = nextLoanId;
        loans[loanId] = Loan({
            borrower: msg.sender,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            collateralLocked: true,
            collateralReleased: 0,
            createdAt: block.timestamp,
            active: true,
            funded: true,
            repaid: false,
            fundDeadline: block.timestamp,         // already funded; deadline irrelevant
            lender: offer.lender,
            requestedPrincipalToken: offer.principalToken,
            requestedPrincipalAmount: offer.principalAmount,
            principalAmount: offer.principalAmount,
            fundedAt: block.timestamp,
            interestRateBps: offer.interestRateBps,
            durationSeconds: offer.durationSeconds,
            amountRepaid: 0,
            principalRepaid: 0,
            interestAccrued: 0,
            lastAccrualAt: block.timestamp,
            liquidationThresholdBps: offer.maxLtvBps,
            lendOfferId: offerId
        });
        nextLoanId++;
    }

    /// @notice Accept a lend offer by posting ETH as collateral.
    function acceptLendOffer(uint256 offerId) external payable nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Offer already accepted");
        require(block.timestamp <= offer.acceptDeadline, "Offer expired");
        require(msg.value >= offer.minCollateralAmount, "Collateral below minimum");
        require(offer.requiredCollateralToken == address(0), "Offer requires ERC20 collateral");

        offer.active = false;
        offer.accepted = true;

        lockedEthCollateral[msg.sender] += msg.value;

        uint256 loanId = _createLoanFromOffer(offerId, offer, address(0), msg.value);
        offer.acceptedLoanId = loanId;

        // Apply min-interest floor at funding time (mirrors fundLoan behaviour)
        if (minInterestBps > 0) {
            loans[loanId].interestAccrued = (offer.principalAmount * minInterestBps) / 10000;
        }

        // Disburse principal to borrower
        if (offer.principalToken == address(0)) {
            _payoutEth(msg.sender, offer.principalAmount);
        } else {
            _payoutToken(offer.principalToken, msg.sender, offer.principalAmount);
        }

        emit LendOfferAccepted(offerId, loanId, msg.sender);
    }
```

- [ ] **Step 7: Implement `acceptLendOfferWithERC20` (ERC20 collateral)**

```solidity
    /// @notice Accept a lend offer by posting an ERC20 token as collateral.
    function acceptLendOfferWithERC20(uint256 offerId, uint256 collateralAmount) external nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Offer already accepted");
        require(block.timestamp <= offer.acceptDeadline, "Offer expired");
        require(collateralAmount >= offer.minCollateralAmount, "Collateral below minimum");
        require(offer.requiredCollateralToken != address(0), "Offer requires ETH collateral");

        uint256 balanceBefore = IERC20(offer.requiredCollateralToken).balanceOf(address(this));
        IERC20(offer.requiredCollateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);
        uint256 received = IERC20(offer.requiredCollateralToken).balanceOf(address(this)) - balanceBefore;
        require(received == collateralAmount, "Fee-on-transfer collateral not supported");

        offer.active = false;
        offer.accepted = true;

        uint256 loanId = _createLoanFromOffer(offerId, offer, offer.requiredCollateralToken, collateralAmount);
        offer.acceptedLoanId = loanId;

        if (minInterestBps > 0) {
            loans[loanId].interestAccrued = (offer.principalAmount * minInterestBps) / 10000;
        }

        if (offer.principalToken == address(0)) {
            _payoutEth(msg.sender, offer.principalAmount);
        } else {
            _payoutToken(offer.principalToken, msg.sender, offer.principalAmount);
        }

        emit LendOfferAccepted(offerId, loanId, msg.sender);
    }
```

- [ ] **Step 8: Implement `cancelLendOffer` and `expireLendOffer`**

```solidity
    /// @notice Cancel a lend offer and return the locked principal. Only the lender may call this.
    function cancelLendOffer(uint256 offerId) external nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Cannot cancel accepted offer");
        require(msg.sender == offer.lender, "Only lender can cancel");

        offer.active = false;

        if (offer.principalToken == address(0)) {
            (bool ok, ) = payable(offer.lender).call{value: offer.principalAmount}("");
            require(ok, "ETH principal return failed");
        } else {
            IERC20(offer.principalToken).safeTransfer(offer.lender, offer.principalAmount);
        }

        emit LendOfferCancelled(offerId, offer.lender);
    }

    /// @notice Expire a lend offer after its accept deadline. Permissionless. Returns principal to lender.
    function expireLendOffer(uint256 offerId) external nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Cannot expire accepted offer");
        require(block.timestamp > offer.acceptDeadline, "Offer still active");

        offer.active = false;

        if (offer.principalToken == address(0)) {
            (bool ok, ) = payable(offer.lender).call{value: offer.principalAmount}("");
            require(ok, "ETH principal return failed");
        } else {
            IERC20(offer.principalToken).safeTransfer(offer.lender, offer.principalAmount);
        }

        emit LendOfferExpired(offerId);
    }
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd packages/contracts && npx hardhat test test/VouchVault.test.ts --grep "lendOffer"
```

Expected: all `lendOffer` tests pass. Also run the full suite:

```bash
npx hardhat test
```

Expected: all tests pass (no regressions on existing tests).

- [ ] **Step 10: Rebuild TypeChain types**

```bash
cd packages/contracts && npx hardhat compile
```

This regenerates `typechain-types/` so the TypeScript API and frontend can import the new function signatures.

- [ ] **Step 11: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add LendOffer struct, createLendOffer, acceptLendOffer, cancelLendOffer, expireLendOffer"
```

---

### Task 2: Database — migrations for lend_offers table and stored procedures

**Files:**
- Create: `supabase/migrations/20260818000000_lend_offer_enum.sql`
- Create: `supabase/migrations/20260818000001_lend_offers_table.sql`
- Create: `supabase/migrations/20260818000002_loans_lend_offer_fk.sql`
- Create: `supabase/migrations/20260818000003_create_lend_offer_with_transaction.sql`
- Create: `supabase/migrations/20260818000004_accept_lend_offer_with_transaction.sql`
- Create: `supabase/migrations/20260818000005_cancel_lend_offer_with_transaction.sql`
- Create: `supabase/migrations/20260818000006_expire_lend_offer_with_transaction.sql`

**Interfaces:**
- Consumes: existing `chains`, `tokens`, `loans`, `transactions` tables; `address`, `uint256` custom types
- Produces: `lend_offers` table; RPC functions `create_lend_offer_with_transaction`, `accept_lend_offer_with_transaction`, `cancel_lend_offer_with_transaction`, `expire_lend_offer_with_transaction`

- [ ] **Step 1: Create ENUM migration**

Create `supabase/migrations/20260818000000_lend_offer_enum.sql`:

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lendOfferStatus') THEN
        CREATE TYPE "lendOfferStatus" AS ENUM ('pending', 'accepted', 'cancelled', 'expired');
    END IF;
END$$;
```

- [ ] **Step 2: Create lend_offers table migration**

Create `supabase/migrations/20260818000001_lend_offers_table.sql`:

```sql
CREATE TABLE IF NOT EXISTS lend_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "onChainOfferId" uint256 NOT NULL,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "lenderAddress" address NOT NULL,
    "principalTokenId" uuid NOT NULL REFERENCES tokens (id),
    "principalAmount" text NOT NULL,
    "collateralTokenId" uuid NOT NULL REFERENCES tokens (id),
    "minCollateralAmount" text NOT NULL,
    "maxLtvBps" integer NOT NULL,
    "interestRateBps" integer NOT NULL,
    duration interval NOT NULL,
    "acceptDeadline" timestamptz NOT NULL,
    status "lendOfferStatus" NOT NULL DEFAULT 'pending',
    "acceptedLoanId" uuid REFERENCES loans (id),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lend_offers_chain_offer_unique
    ON lend_offers ("chainId", "onChainOfferId");

CREATE INDEX IF NOT EXISTS lend_offers_lender_idx ON lend_offers ("lenderAddress");
CREATE INDEX IF NOT EXISTS lend_offers_status_deadline_idx ON lend_offers (status, "acceptDeadline");

CREATE TRIGGER update_lend_offers_updated_at
BEFORE UPDATE ON lend_offers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lend_offers ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Add lend_offer_id column to loans**

Create `supabase/migrations/20260818000002_loans_lend_offer_fk.sql`:

```sql
ALTER TABLE loans
ADD COLUMN IF NOT EXISTS "lendOfferId" uuid REFERENCES lend_offers (id);
```

- [ ] **Step 4: Create `create_lend_offer_with_transaction` procedure**

Create `supabase/migrations/20260818000003_create_lend_offer_with_transaction.sql`:

```sql
CREATE OR REPLACE FUNCTION create_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_lender_address address,
    p_principal_token_address address,
    p_principal_amount text,
    p_collateral_token_address address,
    p_min_collateral_amount text,
    p_max_ltv_bps integer,
    p_interest_rate_bps integer,
    p_duration_seconds integer,
    p_accept_deadline timestamptz,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_created_at timestamptz
) RETURNS void LANGUAGE plpgsql
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_principal_token_id uuid;
    v_collateral_token_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id INTO v_principal_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_principal_token_address;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Principal token not found: %', p_principal_token_address;
    END IF;

    SELECT id INTO v_collateral_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_collateral_token_address;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Collateral token not found: %', p_collateral_token_address;
    END IF;

    INSERT INTO public.lend_offers (
        "onChainOfferId", "chainId", "lenderAddress",
        "principalTokenId", "principalAmount",
        "collateralTokenId", "minCollateralAmount",
        "maxLtvBps", "interestRateBps",
        duration, "acceptDeadline", status, "createdAt"
    ) VALUES (
        p_on_chain_offer_id, v_chain_id, p_lender_address,
        v_principal_token_id, p_principal_amount,
        v_collateral_token_id, p_min_collateral_amount,
        p_max_ltv_bps, p_interest_rate_bps,
        make_interval(secs => p_duration_seconds), p_accept_deadline,
        'pending', p_created_at
    )
    ON CONFLICT ("chainId", "onChainOfferId") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION create_lend_offer_with_transaction(
    text, address, uint256, address, address, text, address, text,
    integer, integer, integer, timestamptz, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_lend_offer_with_transaction(
    text, address, uint256, address, address, text, address, text,
    integer, integer, integer, timestamptz, text, uint256, text, uint256, timestamptz
) TO service_role;
```

- [ ] **Step 5: Create `accept_lend_offer_with_transaction` procedure**

Create `supabase/migrations/20260818000004_accept_lend_offer_with_transaction.sql`:

```sql
CREATE OR REPLACE FUNCTION accept_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_on_chain_loan_id uint256,
    p_borrower_address address,
    p_collateral_amount text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_accepted_at timestamptz
) RETURNS void LANGUAGE plpgsql
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_offer_id uuid;
    v_principal_token_id uuid;
    v_collateral_token_id uuid;
    v_principal_amount text;
    v_lender_address address;
    v_interest_rate_bps integer;
    v_duration interval;
    v_loan_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id, "principalTokenId", "collateralTokenId", "principalAmount",
           "lenderAddress", "interestRateBps", duration
    INTO v_offer_id, v_principal_token_id, v_collateral_token_id, v_principal_amount,
         v_lender_address, v_interest_rate_bps, v_duration
    FROM public.lend_offers
    WHERE "onChainOfferId" = p_on_chain_offer_id AND "chainId" = v_chain_id;

    IF v_offer_id IS NULL THEN
        RAISE EXCEPTION 'Lend offer not found: onChainOfferId=%, chainId=%', p_on_chain_offer_id, v_chain_id;
    END IF;

    -- Mark offer accepted
    UPDATE public.lend_offers
    SET status = 'accepted'
    WHERE id = v_offer_id;

    -- Create the loan row (already active/funded)
    INSERT INTO public.loans (
        "onChainLoanId", "chainId", "borrowerAddress", "lenderAddress",
        "principalTokenId", "collateralTokenId",
        "principalAmount", "collateralAmount",
        "interestRate", duration,
        status, "startAt", "fundedAt", "lendOfferId", "createdAt"
    ) VALUES (
        p_on_chain_loan_id, v_chain_id, p_borrower_address, v_lender_address,
        v_principal_token_id, v_collateral_token_id,
        v_principal_amount, p_collateral_amount,
        v_interest_rate_bps, v_duration,
        'active', p_accepted_at, p_accepted_at, v_offer_id, p_accepted_at
    )
    ON CONFLICT ("chainId", "onChainLoanId") DO NOTHING
    RETURNING id INTO v_loan_id;

    IF v_loan_id IS NULL THEN
        -- Already inserted (duplicate event); look up existing
        SELECT id INTO v_loan_id FROM public.loans
        WHERE "onChainLoanId" = p_on_chain_loan_id AND "chainId" = v_chain_id;
    END IF;

    -- Link offer → loan
    UPDATE public.lend_offers SET "acceptedLoanId" = v_loan_id WHERE id = v_offer_id;

    -- collateral_deposit transaction
    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'collateral_deposit', 'confirmed',
        p_borrower_address, p_contract_address,
        p_collateral_amount, p_log_index, p_accepted_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    -- loan_disbursement transaction
    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_principal_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'loan_disbursement', 'confirmed',
        p_contract_address, p_borrower_address,
        v_principal_amount, p_log_index + 1, p_accepted_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION accept_lend_offer_with_transaction(
    text, address, uint256, uint256, address, text, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION accept_lend_offer_with_transaction(
    text, address, uint256, uint256, address, text, text, uint256, text, uint256, timestamptz
) TO service_role;
```

- [ ] **Step 6: Create `cancel_lend_offer_with_transaction` procedure**

Create `supabase/migrations/20260818000005_cancel_lend_offer_with_transaction.sql`:

```sql
CREATE OR REPLACE FUNCTION cancel_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_lender_address address,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_cancelled_at timestamptz
) RETURNS void LANGUAGE plpgsql
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    UPDATE public.lend_offers
    SET status = 'cancelled'
    WHERE "onChainOfferId" = p_on_chain_offer_id AND "chainId" = v_chain_id
      AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION cancel_lend_offer_with_transaction(
    text, address, uint256, address, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cancel_lend_offer_with_transaction(
    text, address, uint256, address, text, uint256, text, uint256, timestamptz
) TO service_role;
```

- [ ] **Step 7: Create `expire_lend_offer_with_transaction` procedure**

Create `supabase/migrations/20260818000006_expire_lend_offer_with_transaction.sql`:

```sql
CREATE OR REPLACE FUNCTION expire_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_expired_at timestamptz
) RETURNS void LANGUAGE plpgsql
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    UPDATE public.lend_offers
    SET status = 'expired'
    WHERE "onChainOfferId" = p_on_chain_offer_id AND "chainId" = v_chain_id
      AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION expire_lend_offer_with_transaction(
    text, address, uint256, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION expire_lend_offer_with_transaction(
    text, address, uint256, text, uint256, text, uint256, timestamptz
) TO service_role;
```

- [ ] **Step 8: Apply migrations locally**

```bash
npx supabase db reset
```

Expected: migration runs without errors, tables and functions present.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): add lend_offers table, enum, FK on loans, and stored procedures"
```

---

### Task 3: API — DTOs, service methods, and event listeners

**Files:**
- Create: `apps/api/src/loans/dto/create-lend-offer.dto.ts`
- Create: `apps/api/src/loans/dto/accept-lend-offer.dto.ts`
- Create: `apps/api/src/loans/dto/cancel-lend-offer.dto.ts`
- Create: `apps/api/src/loans/dto/expire-lend-offer.dto.ts`
- Modify: `apps/api/src/loans/loans.service.ts`
- Modify: `apps/api/src/blockchain-listener/blockchain-listener.service.ts`

**Interfaces:**
- Consumes: `VouchVault` TypeChain contract (rebuilt in Task 1), Supabase RPC functions from Task 2, `@IsBigInt()` decorator from `../../decorators/is-bigint.decorator`
- Produces: `LoansService.createLendOffer(dto)`, `LoansService.acceptLendOffer(dto)`, `LoansService.cancelLendOffer(dto)`, `LoansService.expireLendOffer(dto)`; event listeners in `BlockchainListenerService.setupEventListener`

- [ ] **Step 1: Write failing unit tests for service methods**

Create `apps/api/src/loans/loans.service.lend-offer.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { LoansService } from './loans.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('LoansService lend offer methods', () => {
  let service: LoansService;
  let rpcMock: jest.Mock;

  beforeEach(async () => {
    rpcMock = jest.fn().mockResolvedValue({ error: null });
    const module = await Test.createTestingModule({
      providers: [
        LoansService,
        {
          provide: SupabaseService,
          useValue: { client: { rpc: rpcMock } },
        },
      ],
    }).compile();
    service = module.get(LoansService);
  });

  it('createLendOffer calls create_lend_offer_with_transaction', async () => {
    await service.createLendOffer({
      offerId: 0n,
      lenderAddress: '0xLender',
      principalTokenAddress: '0x0000000000000000000000000000000000000000',
      principalAmount: 1000000000000000000n,
      collateralTokenAddress: '0x0000000000000000000000000000000000000000',
      minCollateralAmount: 1500000000000000000n,
      maxLtvBps: 6500,
      interestRateBps: 800,
      durationSeconds: 2592000,
      acceptWindowSeconds: 604800,
      networkId: '11155111',
      contractAddress: '0xVault',
      txHash: '0xabc',
      blockNumber: 100,
      blockHash: '0xblock',
      logIndex: 0,
      createdAt: new Date('2026-08-18T00:00:00Z'),
    });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_lend_offer_with_transaction',
      expect.objectContaining({ p_on_chain_offer_id: '0' }),
    );
  });

  it('cancelLendOffer calls cancel_lend_offer_with_transaction', async () => {
    await service.cancelLendOffer({
      offerId: 0n,
      lenderAddress: '0xLender',
      networkId: '11155111',
      contractAddress: '0xVault',
      txHash: '0xabc',
      blockNumber: 101,
      blockHash: '0xblock',
      logIndex: 0,
      cancelledAt: new Date('2026-08-18T01:00:00Z'),
    });
    expect(rpcMock).toHaveBeenCalledWith(
      'cancel_lend_offer_with_transaction',
      expect.objectContaining({ p_on_chain_offer_id: '0' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test -- --testPathPattern="loans.service.lend-offer"
```

Expected: `service.createLendOffer is not a function`.

- [ ] **Step 3: Create `create-lend-offer.dto.ts`**

```typescript
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CreateLendOfferDto {
  @IsBigInt()
  offerId!: bigint;

  @IsString()
  lenderAddress!: string;

  @IsString()
  principalTokenAddress!: string;

  @IsBigInt()
  principalAmount!: bigint;

  @IsString()
  collateralTokenAddress!: string;

  @IsBigInt()
  minCollateralAmount!: bigint;

  @IsNumber()
  maxLtvBps!: number;

  @IsNumber()
  interestRateBps!: number;

  @IsNumber()
  durationSeconds!: number;

  @IsNumber()
  acceptWindowSeconds!: number;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  txHash!: string;

  @IsNumber()
  blockNumber!: number;

  @IsString()
  blockHash!: string;

  @IsNumber()
  logIndex!: number;

  @IsDate()
  @Type(() => Date)
  createdAt!: Date;
}
```

- [ ] **Step 4: Create `accept-lend-offer.dto.ts`**

```typescript
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class AcceptLendOfferDto {
  @IsBigInt()
  offerId!: bigint;

  @IsBigInt()
  loanId!: bigint;

  @IsString()
  borrowerAddress!: string;

  @IsBigInt()
  collateralAmount!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  txHash!: string;

  @IsNumber()
  blockNumber!: number;

  @IsString()
  blockHash!: string;

  @IsNumber()
  logIndex!: number;

  @IsDate()
  @Type(() => Date)
  acceptedAt!: Date;
}
```

- [ ] **Step 5: Create `cancel-lend-offer.dto.ts`**

```typescript
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CancelLendOfferDto {
  @IsBigInt()
  offerId!: bigint;

  @IsString()
  lenderAddress!: string;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  txHash!: string;

  @IsNumber()
  blockNumber!: number;

  @IsString()
  blockHash!: string;

  @IsNumber()
  logIndex!: number;

  @IsDate()
  @Type(() => Date)
  cancelledAt!: Date;
}
```

- [ ] **Step 6: Create `expire-lend-offer.dto.ts`**

```typescript
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class ExpireLendOfferDto {
  @IsBigInt()
  offerId!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  txHash!: string;

  @IsNumber()
  blockNumber!: number;

  @IsString()
  blockHash!: string;

  @IsNumber()
  logIndex!: number;

  @IsDate()
  @Type(() => Date)
  expiredAt!: Date;
}
```

- [ ] **Step 7: Add service methods to `loans.service.ts`**

Add these imports at the top of `apps/api/src/loans/loans.service.ts`:

```typescript
import { AcceptLendOfferDto } from './dto/accept-lend-offer.dto';
import { CancelLendOfferDto } from './dto/cancel-lend-offer.dto';
import { CreateLendOfferDto } from './dto/create-lend-offer.dto';
import { ExpireLendOfferDto } from './dto/expire-lend-offer.dto';
```

Add these methods to the `LoansService` class (after `recordProtocolFee`):

```typescript
  async createLendOffer({
    lenderAddress,
    principalTokenAddress,
    principalAmount,
    collateralTokenAddress,
    minCollateralAmount,
    maxLtvBps,
    interestRateBps,
    durationSeconds,
    acceptWindowSeconds,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    createdAt,
    ...dto
  }: CreateLendOfferDto) {
    const acceptDeadline = new Date(
      createdAt.getTime() + acceptWindowSeconds * 1000,
    );
    const { error } = await this.supabaseService.client.rpc(
      'create_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: dto.offerId.toString(),
        p_lender_address: asAddress(lenderAddress),
        p_principal_token_address: asAddress(principalTokenAddress),
        p_principal_amount: principalAmount.toString(),
        p_collateral_token_address: asAddress(collateralTokenAddress),
        p_min_collateral_amount: minCollateralAmount.toString(),
        p_max_ltv_bps: maxLtvBps,
        p_interest_rate_bps: interestRateBps,
        p_duration_seconds: durationSeconds,
        p_accept_deadline: acceptDeadline.toISOString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_created_at: createdAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async acceptLendOffer({
    offerId,
    loanId,
    borrowerAddress,
    collateralAmount,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    acceptedAt,
  }: AcceptLendOfferDto) {
    const { error } = await this.supabaseService.client.rpc(
      'accept_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: offerId.toString(),
        p_on_chain_loan_id: loanId.toString(),
        p_borrower_address: asAddress(borrowerAddress),
        p_collateral_amount: collateralAmount.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_accepted_at: acceptedAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async cancelLendOffer({
    offerId,
    lenderAddress,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    cancelledAt,
  }: CancelLendOfferDto) {
    const { error } = await this.supabaseService.client.rpc(
      'cancel_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: offerId.toString(),
        p_lender_address: asAddress(lenderAddress),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_cancelled_at: cancelledAt.toISOString(),
      },
    );
    if (error) throw error;
  }

  async expireLendOffer({
    offerId,
    networkId,
    contractAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    expiredAt,
  }: ExpireLendOfferDto) {
    const { error } = await this.supabaseService.client.rpc(
      'expire_lend_offer_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_offer_id: offerId.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_expired_at: expiredAt.toISOString(),
      },
    );
    if (error) throw error;
  }
```

- [ ] **Step 8: Add four event listeners to `blockchain-listener.service.ts`**

Inside `setupEventListener`, after the existing `LoanExpired` listener block, add:

```typescript
    void contract.on(
      contract.getEvent('LendOfferCreated'),
      (offerId, lender, principalToken, principalAmount, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferCreated(
            offerId,
            lender,
            principalToken,
            principalAmount,
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LendOfferAccepted'),
      (offerId, loanId, borrower, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferAccepted(
            offerId,
            loanId,
            borrower,
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LendOfferCancelled'),
      (offerId, lender, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferCancelled(
            offerId,
            lender,
            resolveEventLog(event),
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LendOfferExpired'),
      (offerId, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferExpired(
            offerId,
            resolveEventLog(event),
            network,
            config.contractAddress,
          ),
        );
      },
    );
```

Add the handler methods to `BlockchainListenerService` (after `handleProtocolFeeCollected`):

```typescript
  protected async handleLendOfferCreated(
    offerId: bigint,
    lender: string,
    principalToken: string,
    principalAmount: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
    contract: VouchVault,
  ) {
    let durationSeconds = 0;
    let acceptWindowSeconds = 0;
    try {
      const offer = await contract.lendOffers(offerId);
      durationSeconds = Number(offer.durationSeconds);
      const block = await contract.runner?.provider?.getBlock(blockNumber);
      const createdTimestamp = block?.timestamp ?? Math.floor(Date.now() / 1000);
      acceptWindowSeconds = Number(offer.acceptDeadline) - createdTimestamp;
    } catch (err) {
      this.logger.error('Failed to read lend offer details from chain', err);
    }

    try {
      await this.loanService.createLendOffer({
        offerId,
        lenderAddress: lender,
        principalTokenAddress: principalToken,
        principalAmount,
        collateralTokenAddress: (await contract.lendOffers(offerId)).requiredCollateralToken,
        minCollateralAmount: (await contract.lendOffers(offerId)).minCollateralAmount,
        maxLtvBps: Number((await contract.lendOffers(offerId)).maxLtvBps),
        interestRateBps: Number((await contract.lendOffers(offerId)).interestRateBps),
        durationSeconds,
        acceptWindowSeconds,
        networkId: network.chainId.toString(),
        contractAddress,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        createdAt: new Date(
          ((await contract.runner?.provider?.getBlock(blockNumber))?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
        ),
      });
      this.logger.log(`LendOffer ${offerId.toString()} created by ${lender}`);
    } catch (error) {
      this.logger.error('Failed to create lend offer in DB', error);
    }
  }

  protected async handleLendOfferAccepted(
    offerId: bigint,
    loanId: bigint,
    borrower: string,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
    contract: VouchVault,
  ) {
    try {
      const loan = await contract.loans(loanId);
      await this.loanService.acceptLendOffer({
        offerId,
        loanId,
        borrowerAddress: borrower,
        collateralAmount: loan.collateralAmount,
        networkId: network.chainId.toString(),
        contractAddress,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        acceptedAt: new Date(Number(loan.fundedAt) * 1000),
      });
      this.logger.log(`LendOffer ${offerId.toString()} accepted by ${borrower} → loan ${loanId.toString()}`);
    } catch (error) {
      this.logger.error('Failed to accept lend offer in DB', error);
    }
  }

  protected async handleLendOfferCancelled(
    offerId: bigint,
    lender: string,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.cancelLendOffer({
        offerId,
        lenderAddress: lender,
        networkId: network.chainId.toString(),
        contractAddress,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        cancelledAt: new Date(),
      });
      this.logger.log(`LendOffer ${offerId.toString()} cancelled by ${lender}`);
    } catch (error) {
      this.logger.error('Failed to cancel lend offer in DB', error);
    }
  }

  protected async handleLendOfferExpired(
    offerId: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.expireLendOffer({
        offerId,
        networkId: network.chainId.toString(),
        contractAddress,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        expiredAt: new Date(),
      });
      this.logger.log(`LendOffer ${offerId.toString()} expired`);
    } catch (error) {
      this.logger.error('Failed to expire lend offer in DB', error);
    }
  }
```

- [ ] **Step 9: Run API tests**

```bash
cd apps/api && pnpm test -- --testPathPattern="loans.service.lend-offer"
```

Expected: both tests pass.

- [ ] **Step 10: Run full API type-check**

```bash
cd apps/api && pnpm build
```

Expected: compiles without TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/loans/dto/ apps/api/src/loans/loans.service.ts apps/api/src/blockchain-listener/blockchain-listener.service.ts
git commit -m "feat(api): add lend offer DTOs, service methods, and blockchain event listeners"
```

---

### Task 4: Frontend wallet functions

**Files:**
- Modify: `apps/web/src/lib/wallet/vouchVault.ts`

**Interfaces:**
- Consumes: TypeChain `VouchVault` (rebuilt in Task 1), `Token` type from `../../api/chain`, `getVouchVaultContract`, `ERC20_ABI`, `isNativeToken` (all already in the file)
- Produces: `createLendOffer(principalToken, principalAmount, collateralToken, minCollateral, maxLtvBps, rateBps, durationSeconds, acceptWindowSeconds) → Promise<CreateLendOfferResult>`, `acceptLendOffer(offerId, collateralToken, collateralAmount) → Promise<AcceptLendOfferResult>`, `cancelLendOffer(offerId) → Promise<ethers.TransactionReceipt>`

- [ ] **Step 1: Add wallet functions to `vouchVault.ts`**

Append to `apps/web/src/lib/wallet/vouchVault.ts`:

```typescript
export type CreateLendOfferResult = {
  receipt: ethers.TransactionReceipt;
  onChainOfferId: bigint;
};

export const createLendOffer = async (
  principalToken: Token,
  principalAmount: string,
  collateralToken: Token,
  minCollateral: string,
  maxLtvBps: number,
  rateBps: number,
  durationSeconds: number,
  acceptWindowSeconds: number,
): Promise<CreateLendOfferResult> => {
  const contract = await getVouchVaultContract();
  const collateralTokenAddress = isNativeToken(collateralToken) ? ethers.ZeroAddress : collateralToken.address;
  const minCollateralParsed = ethers.parseUnits(minCollateral, collateralToken.decimals ?? 18);

  let tx: ethers.TransactionResponse;

  if (isNativeToken(principalToken)) {
    const value = ethers.parseEther(principalAmount);
    tx = await contract.createLendOffer(
      collateralTokenAddress,
      minCollateralParsed,
      maxLtvBps,
      rateBps,
      durationSeconds,
      acceptWindowSeconds,
      { value },
    );
  } else {
    const principalAmountParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
    const erc20 = new ethers.Contract(principalToken.address, ERC20_ABI, contract.runner);
    const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
    const allowance: bigint = await erc20.allowance(signer, contract.target);
    if (allowance < principalAmountParsed) {
      const approveTx = await erc20.approve(contract.target, principalAmountParsed);
      await approveTx.wait();
    }
    tx = await contract.createLendOfferWithERC20(
      principalToken.address,
      principalAmountParsed,
      collateralTokenAddress,
      minCollateralParsed,
      maxLtvBps,
      rateBps,
      durationSeconds,
      acceptWindowSeconds,
    );
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');

  let onChainOfferId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'LendOfferCreated') {
        onChainOfferId = parsed.args[0] as bigint;
        break;
      }
    } catch {
      // skip logs from other contracts
    }
  }

  if (onChainOfferId === undefined) throw new Error('LendOfferCreated event not found in receipt');
  return { receipt, onChainOfferId };
};

export type AcceptLendOfferResult = {
  receipt: ethers.TransactionReceipt;
  loanId: bigint;
};

export const acceptLendOffer = async (
  offerId: bigint,
  collateralToken: Token,
  collateralAmount: string,
): Promise<AcceptLendOfferResult> => {
  const contract = await getVouchVaultContract();
  const collateralParsed = ethers.parseUnits(collateralAmount, collateralToken.decimals ?? 18);

  let tx: ethers.TransactionResponse;

  if (isNativeToken(collateralToken)) {
    tx = await contract.acceptLendOffer(offerId, { value: collateralParsed });
  } else {
    const erc20 = new ethers.Contract(collateralToken.address, ERC20_ABI, contract.runner);
    const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
    const allowance: bigint = await erc20.allowance(signer, contract.target);
    if (allowance < collateralParsed) {
      const approveTx = await erc20.approve(contract.target, collateralParsed);
      await approveTx.wait();
    }
    tx = await contract.acceptLendOfferWithERC20(offerId, collateralParsed);
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');

  let loanId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'LendOfferAccepted') {
        loanId = parsed.args[1] as bigint;
        break;
      }
    } catch {
      // skip logs from other contracts
    }
  }

  if (loanId === undefined) throw new Error('LendOfferAccepted event not found in receipt');
  return { receipt, loanId };
};

export const cancelLendOffer = async (offerId: bigint): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const tx: ethers.TransactionResponse = await contract.cancelLendOffer(offerId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};
```

- [ ] **Step 2: Type-check the web app**

```bash
cd apps/web && pnpm check
```

Expected: no TypeScript errors in `vouchVault.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/wallet/vouchVault.ts
git commit -m "feat(web): add createLendOffer, acceptLendOffer, cancelLendOffer wallet functions"
```

---

### Task 5: Frontend — /lend page and CreateLendOffer component

**Files:**
- Create: `apps/web/src/lib/components/ui/CreateLendOffer.svelte`
- Modify: `apps/web/src/routes/lend/+page.svelte`

**Interfaces:**
- Consumes: `createLendOffer` from `$lib/wallet/vouchVault`, `Token` type from `$api/chain`, shadcn-svelte `Button`, `Card`, `Input` (or `$lib/components/ui/*`), `lucide-svelte` icons, `chainInfo` from `$lib/stores/chainInfo.svelte`, `wallet` from `$lib/wallet/wallet.svelte`
- Produces: a form component the `/lend` page embeds; on submit calls `createLendOffer()` and shows tx hash on success

- [ ] **Step 1: Create `CreateLendOffer.svelte`**

Create `apps/web/src/lib/components/ui/CreateLendOffer.svelte`:

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import type { Token } from '$api/chain';
  import { createLendOffer } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Loader2, Wallet } from '@lucide/svelte';

  let principalToken = $state<Token | null>(null);
  let principalAmount = $state('');
  let collateralToken = $state<Token | null>(null);
  let minCollateral = $state('');
  let maxLtvPct = $state('65');
  let ratePct = $state('8');
  let durationDays = $state('30');
  let acceptWindowDays = $state('7');

  let submitting = $state(false);
  let txHash = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);

  const tokens = $derived(chainInfo.tokens ?? []);

  const maxLtvBps = $derived(Math.round(parseFloat(maxLtvPct || '0') * 100));
  const rateBps = $derived(Math.round(parseFloat(ratePct || '0') * 100));
  const durationSeconds = $derived(Math.round(parseFloat(durationDays || '0') * 86400));
  const acceptWindowSeconds = $derived(Math.round(parseFloat(acceptWindowDays || '0') * 86400));

  const canSubmit = $derived(
    !!wallet.address &&
    !!principalToken &&
    !!collateralToken &&
    parseFloat(principalAmount) > 0 &&
    parseFloat(minCollateral) > 0 &&
    maxLtvBps > 0 &&
    rateBps >= 0 &&
    durationSeconds > 0 &&
    acceptWindowSeconds > 0 &&
    !submitting,
  );

  const handleSubmit = async () => {
    if (!principalToken || !collateralToken) return;
    submitting = true;
    errorMsg = null;
    txHash = null;
    try {
      const result = await createLendOffer(
        principalToken,
        principalAmount,
        collateralToken,
        minCollateral,
        maxLtvBps,
        rateBps,
        durationSeconds,
        acceptWindowSeconds,
      );
      txHash = result.receipt.hash;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Transaction failed';
    } finally {
      submitting = false;
    }
  };
</script>

<Card.Root class="bg-card/40 backdrop-blur-sm border-border/50 shadow-2xl shadow-primary/5">
  <Card.Header>
    <Card.Title class="text-2xl font-black tracking-tight flex items-center gap-2">
      <Wallet class="h-6 w-6 text-primary" />
      Create Lend Offer
    </Card.Title>
    <Card.Description class="text-muted-foreground">
      Lock your principal on-chain. A borrower posts collateral to accept.
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <!-- Principal -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Principal Token</label>
        <select
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          bind:value={principalToken}
        >
          <option value={null}>Select token</option>
          {#each tokens as token}
            <option value={token}>{token.symbol}</option>
          {/each}
        </select>
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Principal Amount</label>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0.00"
          bind:value={principalAmount}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
    </div>

    <!-- Collateral requirements -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Required Collateral Token</label>
        <select
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          bind:value={collateralToken}
        >
          <option value={null}>Select token</option>
          {#each tokens as token}
            <option value={token}>{token.symbol}</option>
          {/each}
        </select>
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Min Collateral Amount</label>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0.00"
          bind:value={minCollateral}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
    </div>

    <!-- Terms -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Max LTV (%)</label>
        <input
          type="number"
          min="1"
          max="100"
          step="0.01"
          placeholder="65"
          bind:value={maxLtvPct}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Interest Rate APR (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          placeholder="8"
          bind:value={ratePct}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Loan Duration (days)</label>
        <input
          type="number"
          min="1"
          step="1"
          placeholder="30"
          bind:value={durationDays}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground">Accept Window (days)</label>
        <input
          type="number"
          min="1"
          step="1"
          placeholder="7"
          bind:value={acceptWindowDays}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
    </div>

    {#if errorMsg}
      <p class="text-sm text-destructive">{errorMsg}</p>
    {/if}

    {#if txHash}
      <p class="text-sm text-muted-foreground break-all">
        Offer created! Tx: <span class="font-mono text-foreground">{txHash}</span>
      </p>
    {/if}
  </Card.Content>
  <Card.Footer>
    {#if !wallet.address}
      <p class="text-sm text-muted-foreground">Connect your wallet to create an offer.</p>
    {:else}
      <Button
        class="w-full font-bold"
        size="lg"
        disabled={!canSubmit}
        onclick={handleSubmit}
      >
        {#if submitting}
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          Creating Offer…
        {:else}
          Create Lend Offer
        {/if}
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>
```

- [ ] **Step 2: Replace the stub in `/lend/+page.svelte`**

Replace the entire content of `apps/web/src/routes/lend/+page.svelte` with:

```svelte
<script lang="ts">
  import CreateLendOffer from '$lib/components/ui/CreateLendOffer.svelte';
</script>

<svelte:head>
  <title>Lend | Vouch</title>
</svelte:head>

<div class="flex flex-col items-center py-6 px-4 space-y-8 animate-in fade-in duration-700">
  <div class="text-center space-y-4">
    <h1 class="text-5xl font-black tracking-tight text-foreground text-center">Lend</h1>
    <p class="text-xl text-muted-foreground font-medium max-w-lg mx-auto">
      Earn yield by providing liquidity to collateralized borrowers.
    </p>
  </div>

  <div class="w-full max-w-2xl mx-auto">
    <CreateLendOffer />
  </div>
</div>
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && pnpm check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/ui/CreateLendOffer.svelte apps/web/src/routes/lend/+page.svelte
git commit -m "feat(web): replace /lend stub with CreateLendOffer form"
```

---

### Task 6: Frontend — Lend Offers tab in /marketplace

**Files:**
- Modify: `apps/web/src/routes/marketplace/+page.svelte`

**Interfaces:**
- Consumes: `acceptLendOffer` from `$lib/wallet/vouchVault`, `lend_offers` Supabase table (status=`pending`, acceptDeadline > now), `Token` type for principal/collateral token joins, `wallet` store, `chainInfo` store, `formatUint256` from `$lib/formatUint256`, `formatLoanTerm` from `$lib/loans/loanMath`, shadcn Tabs (`* as Tabs`)
- Produces: a second tab in the existing Tabs component that lists open lend offers; borrower enters collateral amount and calls `acceptLendOffer`

- [ ] **Step 1: Add lend offers state and fetch logic**

In the `<script>` block of `apps/web/src/routes/marketplace/+page.svelte`, add after the existing state declarations (after `let copiedAddress`):

```typescript
  import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
  import { acceptLendOffer } from '$lib/wallet/vouchVault';

  // --- Lend Offers tab ---
  type LendOfferRow = {
    id: string;
    onChainOfferId: string;
    lenderAddress: string;
    principalAmount: string;
    minCollateralAmount: string;
    maxLtvBps: number;
    interestRateBps: number;
    duration: string;
    acceptDeadline: string;
    status: string;
    principalToken: { symbol: string; decimals: number; address: string } | null;
    collateralToken: { symbol: string; decimals: number; address: string } | null;
  };

  let lendOffers: LendOfferRow[] = $state([]);
  let lendOffersLoading = $state(true);
  let lendOffersError: string | null = $state(null);
  let acceptingOfferId: string | null = $state(null);
  let collateralInputs: Record<string, string> = $state({});

  const fetchLendOffers = async () => {
    try {
      lendOffersError = null;
      const { data, error } = await supabase
        .from('lend_offers')
        .select(
          `*,
           principalToken:tokens!lend_offers_principalTokenId_fkey(*),
           collateralToken:tokens!lend_offers_collateralTokenId_fkey(*)`
        )
        .eq('status', 'pending')
        .gt('acceptDeadline', new Date().toISOString())
        .order('createdAt', { ascending: false });

      if (error) throw error;
      lendOffers = (data as LendOfferRow[]) ?? [];
    } catch (e) {
      lendOffersError = e instanceof Error ? e.message : 'Failed to load offers';
    } finally {
      lendOffersLoading = false;
    }
  };

  const handleAcceptOffer = async (offer: LendOfferRow) => {
    if (!offer.collateralToken) return;
    const collateralAmount = collateralInputs[offer.id] ?? '';
    if (!collateralAmount || parseFloat(collateralAmount) <= 0) return;
    acceptingOfferId = offer.id;
    try {
      await acceptLendOffer(
        BigInt(offer.onChainOfferId),
        { address: offer.collateralToken.address, symbol: offer.collateralToken.symbol, decimals: offer.collateralToken.decimals } as import('$api/chain').Token,
        collateralAmount,
      );
      await fetchLendOffers();
    } catch (e) {
      console.error('Accept offer failed', e);
    } finally {
      acceptingOfferId = null;
    }
  };

  $effect(() => {
    void fetchLendOffers();
  });
```

- [ ] **Step 2: Add the Lend Offers tab UI**

In the template section, find the existing `<Tabs.Root>` component (which already has `activeTab` bound). Add a second `<Tabs.Trigger>` and `<Tabs.Content>`:

After the existing `<Tabs.Trigger value="borrow">` trigger, add:

```svelte
        <Tabs.Trigger value="lend-offers" class="font-semibold">Lend Offers</Tabs.Trigger>
```

After the closing tag of the existing borrow `<Tabs.Content>` block, add:

```svelte
      <Tabs.Content value="lend-offers">
        {#if lendOffersLoading}
          <div class="space-y-3">
            {#each Array(3) as _}
              <div class="h-16 rounded-lg bg-muted animate-pulse"></div>
            {/each}
          </div>
        {:else if lendOffersError}
          <p class="text-sm text-destructive">{lendOffersError}</p>
        {:else if lendOffers.length === 0}
          <div class="text-center py-12 text-muted-foreground">
            <p class="font-medium">No open lend offers right now.</p>
          </div>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row class="border-border/50">
                <Table.Head>Principal</Table.Head>
                <Table.Head>Required Collateral</Table.Head>
                <Table.Head>Min Collateral</Table.Head>
                <Table.Head>Max LTV</Table.Head>
                <Table.Head>Rate (APR)</Table.Head>
                <Table.Head>Duration</Table.Head>
                <Table.Head>Expires</Table.Head>
                <Table.Head class="text-right">Accept</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each lendOffers as offer (offer.id)}
                <Table.Row class="border-border/30 hover:bg-muted/10 transition-colors">
                  <Table.Cell class="font-medium">
                    {formatUint256(offer.principalAmount, offer.principalToken?.decimals ?? 18)}
                    {offer.principalToken?.symbol ?? ''}
                  </Table.Cell>
                  <Table.Cell>{offer.collateralToken?.symbol ?? '—'}</Table.Cell>
                  <Table.Cell>
                    {formatUint256(offer.minCollateralAmount, offer.collateralToken?.decimals ?? 18)}
                    {offer.collateralToken?.symbol ?? ''}
                  </Table.Cell>
                  <Table.Cell>{(offer.maxLtvBps / 100).toFixed(2)}%</Table.Cell>
                  <Table.Cell>{(offer.interestRateBps / 100).toFixed(2)}%</Table.Cell>
                  <Table.Cell>{formatLoanTerm(offer.duration)}</Table.Cell>
                  <Table.Cell class="text-muted-foreground text-sm">
                    {new Date(offer.acceptDeadline).toLocaleDateString()}
                  </Table.Cell>
                  <Table.Cell class="text-right">
                    <div class="flex items-center gap-2 justify-end">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="Collateral amount"
                        bind:value={collateralInputs[offer.id]}
                        class="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground"
                      />
                      <Button
                        size="sm"
                        class="font-bold"
                        disabled={acceptingOfferId === offer.id || !wallet.address}
                        onclick={() => handleAcceptOffer(offer)}
                      >
                        {#if acceptingOfferId === offer.id}
                          <span class="animate-spin mr-1">⟳</span>
                        {/if}
                        Accept
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Tabs.Content>
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && pnpm check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/marketplace/+page.svelte
git commit -m "feat(web): add Lend Offers tab to /marketplace with accept flow"
```

---

### Task 7: Frontend — lender's offers in /dashboard

**Files:**
- Modify: `apps/web/src/routes/dashboard/+page.svelte`

**Interfaces:**
- Consumes: `lend_offers` Supabase table filtered by `lenderAddress = wallet.address`, `cancelLendOffer` from `$lib/wallet/vouchVault`, existing dashboard patterns (`DashboardData`, `wallet` store, `Tabs` component)
- Produces: a third tab "My Offers" showing the lender's lend offers with status badges and a cancel button for pending ones

- [ ] **Step 1: Add offers state and fetch to dashboard**

In `apps/web/src/routes/dashboard/+page.svelte`, add after the existing imports and before the `borrowedData` line:

```typescript
  import { cancelLendOffer } from '$lib/wallet/vouchVault';
  import { supabase } from '$lib/supabase';
  import { Badge } from '$lib/components/ui/badge';
  import * as Table from '$lib/components/ui/table';
  import { Button } from '$lib/components/ui/button';
  import { formatUint256 } from '$lib/formatUint256';

  type LendOfferRow = {
    id: string;
    onChainOfferId: string;
    principalAmount: string;
    minCollateralAmount: string;
    maxLtvBps: number;
    interestRateBps: number;
    duration: string;
    acceptDeadline: string;
    status: 'pending' | 'accepted' | 'cancelled' | 'expired';
    principalToken: { symbol: string; decimals: number } | null;
    collateralToken: { symbol: string; decimals: number } | null;
  };

  let myOffers = $state<LendOfferRow[]>([]);
  let offersLoading = $state(false);
  let cancellingOfferId = $state<string | null>(null);

  const fetchMyOffers = async (address: string) => {
    offersLoading = true;
    try {
      const { data, error } = await supabase
        .from('lend_offers')
        .select(
          `*,
           principalToken:tokens!lend_offers_principalTokenId_fkey(*),
           collateralToken:tokens!lend_offers_collateralTokenId_fkey(*)`
        )
        .eq('lenderAddress', address)
        .order('createdAt', { ascending: false });
      if (error) throw error;
      myOffers = (data as LendOfferRow[]) ?? [];
    } finally {
      offersLoading = false;
    }
  };

  const handleCancelOffer = async (offer: LendOfferRow) => {
    cancellingOfferId = offer.id;
    try {
      await cancelLendOffer(BigInt(offer.onChainOfferId));
      if (wallet.address) await fetchMyOffers(wallet.address);
    } catch (e) {
      console.error('Cancel offer failed', e);
    } finally {
      cancellingOfferId = null;
    }
  };

  const statusVariant = (status: LendOfferRow['status']) => {
    if (status === 'pending') return 'default';
    if (status === 'accepted') return 'secondary';
    return 'outline';
  };
```

In the existing `$effect` that watches `wallet.address`, add `fetchMyOffers` call:

```typescript
  $effect(() => {
    if (!wallet.address) {
      borrowedData.reset();
      lentData.reset();
      creditScore = null;
      myOffers = [];
      return;
    }
    loading = true;
    void Promise.all([fetchBoth(wallet.address), fetchMyOffers(wallet.address)]).finally(() => {
      loading = false;
    });
    void loadCreditScore();
  });
```

- [ ] **Step 2: Add My Offers tab to the dashboard template**

In the template, find the existing `<Tabs.Root>` that switches between `borrowed` and `lent` perspectives. Add a third trigger and content:

After the `<Tabs.Trigger value="lent">` trigger, add:

```svelte
        <Tabs.Trigger value="offers" class="font-semibold">My Offers</Tabs.Trigger>
```

After the `lent` `<Tabs.Content>` closing tag, add:

```svelte
      <Tabs.Content value="offers">
        {#if offersLoading}
          <div class="space-y-3">
            {#each Array(2) as _}
              <div class="h-14 rounded-lg bg-muted animate-pulse"></div>
            {/each}
          </div>
        {:else if myOffers.length === 0}
          <p class="text-center py-10 text-muted-foreground font-medium">No lend offers yet.</p>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row class="border-border/50">
                <Table.Head>Principal</Table.Head>
                <Table.Head>Collateral Req.</Table.Head>
                <Table.Head>Max LTV</Table.Head>
                <Table.Head>Rate</Table.Head>
                <Table.Head>Expires</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head class="text-right">Action</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each myOffers as offer (offer.id)}
                <Table.Row class="border-border/30 hover:bg-muted/10 transition-colors">
                  <Table.Cell class="font-medium">
                    {formatUint256(offer.principalAmount, offer.principalToken?.decimals ?? 18)}
                    {offer.principalToken?.symbol ?? ''}
                  </Table.Cell>
                  <Table.Cell>{offer.collateralToken?.symbol ?? '—'}</Table.Cell>
                  <Table.Cell>{(offer.maxLtvBps / 100).toFixed(2)}%</Table.Cell>
                  <Table.Cell>{(offer.interestRateBps / 100).toFixed(2)}% APR</Table.Cell>
                  <Table.Cell class="text-muted-foreground text-sm">
                    {new Date(offer.acceptDeadline).toLocaleDateString()}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant={statusVariant(offer.status)} class="capitalize">{offer.status}</Badge>
                  </Table.Cell>
                  <Table.Cell class="text-right">
                    {#if offer.status === 'pending'}
                      <Button
                        size="sm"
                        variant="outline"
                        class="font-semibold"
                        disabled={cancellingOfferId === offer.id}
                        onclick={() => handleCancelOffer(offer)}
                      >
                        {cancellingOfferId === offer.id ? 'Cancelling…' : 'Cancel'}
                      </Button>
                    {:else}
                      <span class="text-muted-foreground text-sm">—</span>
                    {/if}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Tabs.Content>
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && pnpm check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/dashboard/+page.svelte
git commit -m "feat(web): add My Offers tab to /dashboard with cancel support"
```

---

## Self-Review Notes

- **Spec coverage:** Contract ✓, DB ✓, API ✓, frontend /lend ✓, /marketplace ✓, /dashboard ✓. All four events (Created/Accepted/Cancelled/Expired) wired end-to-end. Both ETH and ERC20 variants implemented.
- **Storage layout:** `lendOfferId` appended as last field of `Loan` struct — safe for upgradeable proxy.
- **Accept flow:** `_createLoanFromOffer` creates the loan in a `funded=true` state, consistent with `fundLoan` post-state. `minInterestBps` floor applied at accept time, mirroring how `fundLoan` applies it.
- **Duplicate event guard:** `ON CONFLICT ... DO NOTHING` in all stored procedures; service methods throw on non-null error only.
- **handleLendOfferCreated optimization note:** The handler calls `contract.lendOffers(offerId)` multiple times — a future cleanup could consolidate to one call. Correctness is not affected.
