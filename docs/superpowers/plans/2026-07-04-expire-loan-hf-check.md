# Expire Loan + Pre-Funding Health Factor Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `expireLoan` to VouchVault, make `getHealthFactor` work for unfunded loans, enforce HF at funding time, and wire everything through DB migrations, API listener, and frontend.

**Architecture:** Contract changes first (they define the event shape), then DB migrations, then API listener mirroring the existing `cancelLoan` pattern exactly, then frontend removing the off-chain HF projection in favour of the new on-chain read.

**Tech Stack:** Solidity/Hardhat, NestJS (API), Supabase/PostgreSQL, SvelteKit (frontend), TypeScript, ethers v6, TypeChain.

## Global Constraints

- All contract tests use `ethers.provider.send('evm_increaseTime', [seconds])` + `evm_mine` for time manipulation — never use `time.increase` from Hardhat helpers.
- Blockchain listener handlers must be enqueued via `this.enqueue(queueKey, ...)` — never called directly.
- DB functions use `SECURITY DEFINER`, `SET search_path = ''`, `GRANT EXECUTE TO service_role`, `REVOKE ALL FROM PUBLIC`.
- TypeChain types are auto-regenerated — run `pnpm build` in `packages/contracts` after any contract change before touching the API or frontend.
- `pnpm db:generate:types` must be run after any migration to regenerate `packages/database-types/src/generated.ts`.
- Branch: `feat/expire-loan-hf-check`.

---

### Task 1: Update `getHealthFactor` and add HF check to `fundLoan` / `fundLoanWithERC20`

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol` (functions `getHealthFactor`, `fundLoan`, `fundLoanWithERC20`)
- Modify: `packages/contracts/test/VouchVault.test.ts` (update existing "reverts if loan not funded" test, add new tests)

**Interfaces:**
- Produces: `getHealthFactor(loanId)` works for both funded and unfunded loans; `fundLoan`/`fundLoanWithERC20` revert with `"Loan is undercollateralized"` when HF < 1e18.

- [ ] **Step 1: Write failing tests**

Add inside the existing `describe('Oracle / getHealthFactor')` block in `packages/contracts/test/VouchVault.test.ts`:

```typescript
it('getHealthFactor works for unfunded loan using requestedPrincipalAmount', async function () {
  // ETH collateral $3200, MOCK principal $1000 each, threshold 8000 bps (80%)
  // HF = (1e18 * 3200e18 * 8000) / (2e18 * 1000e18 * 10000) = 1.28e18
  const { vault, mockToken, borrower } = await deployWithFeeds();
  const collateral = ethers.parseEther('1');
  const principal = ethers.parseUnits('2', 18);
  await vault.connect(borrower).createLoan(
    await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, { value: collateral }
  );
  const hf = await vault.getHealthFactor(0);
  expect(hf).to.equal(128n * 10n ** 16n); // 1.28e18
});

it('fundLoanWithERC20 reverts when loan is undercollateralized at funding time', async function () {
  // Collateral $100 ETH equivalent, borrow 2 MOCK at $1000 each => HF = 0.04 < 1
  const { vault, mockToken, lender, borrower } = await deployWithFeeds();
  // ETH feed price = $3200, MOCK feed price = $1000 (set in deployWithFeeds)
  // Use tiny collateral and large principal to make HF < 1
  const collateral = ethers.parseEther('0.01'); // $32 collateral
  const principal = ethers.parseUnits('2', 18);  // $2000 principal => HF=0.0128
  await vault.connect(borrower).createLoan(
    await mockToken.getAddress(), principal, 0, 0, 7n * 86400n, 8000, { value: collateral }
  );
  await mockToken.transfer(lender.address, principal);
  await mockToken.connect(lender).approve(await vault.getAddress(), principal);
  await expect(
    vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal)
  ).to.be.revertedWith('Loan is undercollateralized');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/contracts && pnpm test 2>&1 | grep -A3 "getHealthFactor works for unfunded\|undercollateralized at funding"
```

Expected: both tests fail — first with "Loan not funded", second passes (funding currently has no HF check).

- [ ] **Step 3: Update `getHealthFactor` in `VouchVault.sol`**

Replace the existing `getHealthFactor` function:

```solidity
function getHealthFactor(uint256 loanId) public view returns (uint256) {
    Loan memory loan = loans[loanId];
    require(!loan.repaid, "Loan already repaid");

    // For funded loans use actual debt (principal + accrued interest - repaid).
    // For unfunded loans use requestedPrincipalAmount — no interest accrues yet.
    uint256 remainingDebt;
    if (loan.funded) {
        uint256 totalDue = loan.principalAmount + _currentInterestOwed(loan);
        remainingDebt = totalDue > loan.amountRepaid ? totalDue - loan.amountRepaid : 0;
    } else {
        remainingDebt = loan.requestedPrincipalAmount;
    }
    require(remainingDebt > 0, "No remaining debt");

    uint256 lockedCollateral = loan.collateralAmount - loan.collateralReleased;

    uint256 collateralPrice = _getPrice(loan.collateralToken);
    uint256 principalPrice  = _getPrice(loan.requestedPrincipalToken);

    uint256 normalizedCollateral = _normalizeAmount(loan.collateralToken, lockedCollateral);
    uint256 normalizedDebt       = _normalizeAmount(loan.requestedPrincipalToken, remainingDebt);

    uint256 lockedCollateralUSD = normalizedCollateral.mulDiv(collateralPrice, 1e18);
    uint256 remainingDebtUSD    = normalizedDebt.mulDiv(principalPrice, 1e18);

    uint16 effectiveThresholdBps = loan.liquidationThresholdBps == 0
        ? 10000
        : loan.liquidationThresholdBps;

    uint256 thresholdScaled = uint256(effectiveThresholdBps) * 1e18;
    uint256 ratio = lockedCollateralUSD.mulDiv(thresholdScaled, remainingDebtUSD);
    return ratio / 10000;
}
```

- [ ] **Step 4: Add HF check to `fundLoan`**

In `fundLoan`, after `require(msg.value == loan.requestedPrincipalAmount, ...)` and before `loan.lender = msg.sender`:

```solidity
require(getHealthFactor(loanId) >= 1e18, "Loan is undercollateralized");
```

- [ ] **Step 5: Add HF check to `fundLoanWithERC20`**

In `fundLoanWithERC20`, after `require(amount == loan.requestedPrincipalAmount, ...)` and before `loan.lender = msg.sender`:

```solidity
require(getHealthFactor(loanId) >= 1e18, "Loan is undercollateralized");
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd packages/contracts && pnpm test 2>&1 | grep -E "passing|failing|getHealthFactor works for unfunded|undercollateralized at funding"
```

Expected: both new tests pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): support unfunded loans in getHealthFactor, enforce HF at funding"
```

---

### Task 2: Add `expireLoan` to VouchVault

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol` (add event + function)
- Modify: `packages/contracts/test/VouchVault.test.ts` (add `expireLoan` describe block)

**Interfaces:**
- Produces: `LoanExpired(uint256 indexed loanId, address indexed borrower, uint256 timestamp)` event; `expireLoan(uint256 loanId)` permissionless function.

- [ ] **Step 1: Write failing tests**

Add a new `describe('expireLoan')` block in `packages/contracts/test/VouchVault.test.ts`:

```typescript
describe('expireLoan', function () {
  async function deployForExpiry() {
    const [owner, borrower, anyone] = await ethers.getSigners();
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
    const collateral = ethers.parseEther('1');
    const fundWindow = 3n * 86400n; // 3 days
    await vault.connect(borrower).createLoan(
      ethers.ZeroAddress, collateral, 0, 0, fundWindow, 8000, { value: collateral }
    );
    return { vault, borrower, anyone, collateral, fundWindow };
  }

  it('reverts if loan is still within fund window', async function () {
    const { vault } = await deployForExpiry();
    await expect(vault.expireLoan(0)).to.be.revertedWith('Fund window not yet passed');
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

  it('returns collateral to borrower and emits LoanExpired', async function () {
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
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/contracts && pnpm test 2>&1 | grep -A2 "expireLoan"
```

Expected: all `expireLoan` tests fail with "vault.expireLoan is not a function".

- [ ] **Step 3: Add `LoanExpired` event and `expireLoan` function to `VouchVault.sol`**

Add event after `LoanCancelled`:

```solidity
event LoanExpired(
    uint256 indexed loanId,
    address indexed borrower,
    uint256 timestamp
);
```

Add function after `cancelLoan`:

```solidity
/// @notice Expire a pending loan whose funding window has passed, returning collateral to the borrower.
/// @dev Permissionless — anyone can call once block.timestamp > fundDeadline.
function expireLoan(uint256 loanId) external nonReentrant {
    Loan storage loan = loans[loanId];
    require(loan.active, "Loan is not active");
    require(!loan.funded, "Loan already funded");
    require(block.timestamp > loan.fundDeadline, "Fund window not yet passed");

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

    emit LoanExpired(loanId, loan.borrower, block.timestamp);
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/contracts && pnpm test 2>&1 | grep -E "passing|failing"
```

Expected: all tests pass.

- [ ] **Step 5: Rebuild contracts to regenerate TypeChain types**

```bash
cd packages/contracts && pnpm build
```

Expected: no errors. `typechain-types/` updated with `LoanExpired` event.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts packages/contracts/typechain-types/
git commit -m "feat(contracts): add expireLoan permissionless function"
```

---

### Task 3: DB migrations — `expired` status + `expire_loan_with_transaction`

**Files:**
- Create: `supabase/migrations/20260704000000_add_expired_loan_status.sql`
- Create: `supabase/migrations/20260704000100_expire_loan_with_transaction.sql`

**Interfaces:**
- Produces: `loanStatus` enum includes `'expired'`; `expiredAt timestamptz` column on `loans`; `expire_loan_with_transaction(...)` RPC callable by `service_role`.

- [ ] **Step 1: Create enum + column migration**

`supabase/migrations/20260704000000_add_expired_loan_status.sql`:

```sql
ALTER TYPE "loanStatus" ADD VALUE IF NOT EXISTS 'expired';
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS "expiredAt" timestamptz;
```

- [ ] **Step 2: Create `expire_loan_with_transaction` function migration**

`supabase/migrations/20260704000100_expire_loan_with_transaction.sql`:

```sql
-- ----------------------------------------------------------------------------
-- expire_loan_with_transaction(...)
-- Marks a pending loan as expired, sets "expiredAt", and records the on-chain
-- collateral return as a `withdrawal` transaction. Called by the blockchain
-- listener upon LoanExpired events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_loan_with_transaction (
    p_network_id          text,
    p_contract_address    address,
    p_on_chain_loan_id    uint256,
    p_borrower_address    address,
    p_tx_hash             text,
    p_block_number        uint256,
    p_block_hash          text,
    p_log_index           uint256,
    p_expired_at          timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id             uuid;
    v_loan_id              uuid;
    v_collateral_token_id  uuid;
    v_collateral_amount    text;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"        = p_network_id
      AND "contractAddress"  = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    SELECT id, "collateralTokenId", "collateralAmount"
    INTO v_loan_id, v_collateral_token_id, v_collateral_amount
    FROM public.loans
    WHERE "onChainLoanId"   = p_on_chain_loan_id
      AND "chainId"         = v_chain_id
      AND "borrowerAddress" = p_borrower_address;

    IF v_loan_id IS NULL THEN
        RAISE EXCEPTION 'Loan not found: onChainLoanId=%, chainId=%, borrower=%',
            p_on_chain_loan_id, v_chain_id, p_borrower_address;
    END IF;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Loan % has no collateral token set', v_loan_id;
    END IF;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'withdrawal', 'confirmed',
        p_contract_address, p_borrower_address,
        COALESCE(v_collateral_amount, '0'), p_log_index, p_expired_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    -- Idempotent: only expire a still-pending loan.
    UPDATE public.loans
    SET status      = 'expired',
        "expiredAt" = p_expired_at
    WHERE id      = v_loan_id
      AND status  = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.expire_loan_with_transaction (
    text, address, uint256, address,
    text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.expire_loan_with_transaction (
    text, address, uint256, address,
    text, uint256, text, uint256, timestamptz
) TO service_role;
```

- [ ] **Step 3: Apply migrations**

```bash
cd /Users/nadavbarak/Projects/Vouch && npx supabase db reset
```

Expected: migration applies without error.

- [ ] **Step 4: Regenerate TypeScript DB types**

```bash
pnpm db:generate:types
```

Expected: `packages/database-types/src/generated.ts` now includes `'expired'` in the `loanStatus` enum and `expiredAt: string | null` on the loans row type.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260704000000_add_expired_loan_status.sql \
        supabase/migrations/20260704000100_expire_loan_with_transaction.sql \
        packages/database-types/src/generated.ts \
        packages/database-types/src/index.js \
        packages/database-types/dist/
git commit -m "feat(db): add expired loan status and expire_loan_with_transaction"
```

---

### Task 4: API — `ExpireLoanDto`, `LoansService.expire()`, blockchain listener

**Files:**
- Create: `apps/api/src/loans/dto/expire-loan.dto.ts`
- Modify: `apps/api/src/loans/loans.service.ts`
- Modify: `apps/api/src/blockchain-listener/blockchain-listener.service.ts`
- Modify: `apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts` (add test)

**Interfaces:**
- Consumes: `expire_loan_with_transaction` RPC (Task 3); TypeChain `LoanExpired` event (Task 2).
- Produces: `LoansService.expire(dto: ExpireLoanDto): Promise<void>`; `handleLoanExpired` handler.

- [ ] **Step 1: Create `ExpireLoanDto`**

`apps/api/src/loans/dto/expire-loan.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class ExpireLoanDto {
  @IsBigInt()
  onChainLoanId!: bigint;

  @IsNumberString()
  networkId!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  borrowerAddress!: string;

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

- [ ] **Step 2: Add `expire()` to `LoansService`**

In `apps/api/src/loans/loans.service.ts`, add import and method:

```typescript
import { ExpireLoanDto } from './dto/expire-loan.dto';
```

Add method after `cancel()`:

```typescript
async expire({
  onChainLoanId,
  networkId,
  contractAddress,
  borrowerAddress,
  txHash,
  blockNumber,
  blockHash,
  logIndex,
  expiredAt,
}: ExpireLoanDto) {
  const { error } = await this.supabaseService.client.rpc(
    'expire_loan_with_transaction',
    {
      p_network_id: networkId,
      p_contract_address: asAddress(contractAddress),
      p_on_chain_loan_id: onChainLoanId.toString(),
      p_borrower_address: asAddress(borrowerAddress),
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

- [ ] **Step 3: Add `LoanExpired` listener and handler to `BlockchainListenerService`**

In `setupEventListener` in `apps/api/src/blockchain-listener/blockchain-listener.service.ts`, add after the `LoanCancelled` block:

```typescript
void contract.on(
  contract.getEvent('LoanExpired'),
  (loanId, borrower, timestamp, event) => {
    this.enqueue(queueKey, () =>
      this.handleLoanExpired(
        loanId,
        borrower,
        timestamp,
        resolveEventLog(event),
        network,
        config.contractAddress,
      ),
    );
  },
);
```

Add handler method after `handleLoanCancelled`:

```typescript
protected async handleLoanExpired(
  loanId: bigint,
  borrower: string,
  timestamp: bigint,
  { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
  network: ethers.Network,
  contractAddress: string,
) {
  try {
    await this.loanService.expire({
      onChainLoanId: loanId,
      networkId: network.chainId.toString(),
      contractAddress,
      borrowerAddress: borrower,
      txHash: transactionHash,
      blockNumber,
      blockHash,
      logIndex,
      expiredAt: new Date(Number(timestamp) * 1000),
    });
    this.logger.log(`Loan ${loanId.toString()} expired`);
  } catch (error) {
    this.logger.error('Failed to expire loan in DB', error);
  }
}
```

- [ ] **Step 4: Add test for `handleLoanExpired`**

In `apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts`, look for the `handleLoanCancelled` test and add a parallel test:

```typescript
describe('handleLoanExpired', () => {
  it('calls loanService.expire with correct parameters', async () => {
    const loanId = 1n;
    const borrower = '0xBorrower';
    const timestamp = 1700000000n;
    const mockLog = {
      transactionHash: '0xabc',
      blockNumber: 100,
      blockHash: '0xblockhash',
      index: 0,
    } as ethers.Log;
    const mockNetwork = { chainId: 1337n } as ethers.Network;
    const contractAddress = '0xContract';

    const expireSpy = jest.spyOn(loanService, 'expire').mockResolvedValue(undefined);

    await service['handleLoanExpired'](loanId, borrower, timestamp, mockLog, mockNetwork, contractAddress);

    expect(expireSpy).toHaveBeenCalledWith({
      onChainLoanId: loanId,
      networkId: '1337',
      contractAddress,
      borrowerAddress: borrower,
      txHash: '0xabc',
      blockNumber: 100,
      blockHash: '0xblockhash',
      logIndex: 0,
      expiredAt: new Date(Number(timestamp) * 1000),
    });
  });
});
```

- [ ] **Step 5: Run API tests**

```bash
cd apps/api && pnpm test 2>&1 | grep -E "passing|failing|handleLoanExpired|PASS|FAIL"
```

Expected: new test passes, no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/dto/expire-loan.dto.ts \
        apps/api/src/loans/loans.service.ts \
        apps/api/src/blockchain-listener/blockchain-listener.service.ts \
        apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts
git commit -m "feat(api): wire LoanExpired event through listener and loans service"
```

---

### Task 5: Frontend — replace off-chain HF projection with on-chain read, add expired status

**Files:**
- Modify: `apps/web/src/lib/wallet/vouchVault.ts` (remove `getLoanLiquidationThreshold`)
- Modify: `apps/web/src/lib/components/ui/LoanRepayRow.svelte` (replace pending `$effect`)
- Modify: `apps/web/src/lib/components/ui/LoanStatusBadge.svelte` (add expired badge)

**Interfaces:**
- Consumes: `getHealthFactor(onChainLoanId: bigint): Promise<bigint>` from `vouchVault.ts` (already exists, now works for unfunded loans too).

- [ ] **Step 1: Remove `getLoanLiquidationThreshold` from `vouchVault.ts`**

In `apps/web/src/lib/wallet/vouchVault.ts`, delete the entire `getLoanLiquidationThreshold` export (the function and its JSDoc comment).

- [ ] **Step 2: Update the pending loan `$effect` in `LoanRepayRow.svelte`**

In `apps/web/src/lib/components/ui/LoanRepayRow.svelte`:

Remove the import of `calculateHealthFactor` from `loanMath` and `getLoanLiquidationThreshold` from `vouchVault`. Also remove the import of `ethers` if it's only used in the pending effect (check — it may still be used for `ethers.ZeroAddress` elsewhere).

Replace the entire pending loan `$effect` (lines that start `$effect(() => { if (loan.onChainLoanId === null || loan.status !== 'pending')`) with:

```typescript
$effect(() => {
  if (loan.onChainLoanId === null || loan.status !== 'pending') {
    healthFactor = null;
    return;
  }
  hfLoading = true;
  getHealthFactor(BigInt(loan.onChainLoanId))
    .then((hf) => {
      healthFactor = hf;
    })
    .catch(() => {
      healthFactor = null;
    })
    .finally(() => {
      hfLoading = false;
    });
});
```

Remove the separate `$state` for `projectedHf` — it's no longer needed. Both active and pending loans now use the `healthFactor` bigint state and display via `<HealthFactorBadge>`.

Update the Health Factor cell in the template: remove the `{#if isPending && projectedHf !== null}` branch entirely so both pending and active loans render `<HealthFactorBadge {healthFactor} loading={hfLoading} />`.

- [ ] **Step 3: Add `expired` badge to `LoanStatusBadge.svelte`**

In `apps/web/src/lib/components/ui/LoanStatusBadge.svelte`, add after the `cancelled` branch:

```svelte
{:else if status === 'expired'}
  <Badge class="text-muted-foreground text-xs gap-1" variant="outline">
    <XCircle class="h-3 w-3" /> Expired
  </Badge>
```

- [ ] **Step 4: Handle expired rows in `LoanRepayRow.svelte`**

In `LoanRepayRow.svelte`, add to the derived status booleans:

```typescript
const isExpired = $derived(loan.status === 'expired');
```

In the `<Table.Row>` class, add `isExpired` to the opacity condition (same as repaid):

```svelte
<Table.Row class={cn('hover:bg-muted/10 transition-colors', (isRepaid || isExpired) && 'opacity-60', isOverdue && 'bg-destructive/5')}>
```

In the Action cell, the existing `{:else if isPending ...}` block already shows "Cancel request" — expired loans fall through to no button (terminal state), which is correct since none of the conditions match. Verify this is the case — no change needed if so.

Pass `status={loan.status}` already passes through to `LoanStatusBadge` which will now render "Expired" for `status === 'expired'`.

- [ ] **Step 5: Type-check**

```bash
cd apps/web && pnpm check 2>&1 | grep -E "error|Error|0 errors"
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/wallet/vouchVault.ts \
        apps/web/src/lib/components/ui/LoanRepayRow.svelte \
        apps/web/src/lib/components/ui/LoanStatusBadge.svelte
git commit -m "feat(web): use on-chain getHealthFactor for pending loans, add expired badge"
```

---

## Self-Review

**Spec coverage:**
- ✅ `getHealthFactor` for unfunded loans — Task 1
- ✅ HF check in `fundLoan` / `fundLoanWithERC20` — Task 1
- ✅ `expireLoan` permissionless function + `LoanExpired` event — Task 2
- ✅ `expired` DB status + `expiredAt` column — Task 3
- ✅ `expire_loan_with_transaction` Postgres function — Task 3
- ✅ API listener `LoanExpired` handler — Task 4
- ✅ Frontend: replace projected HF with on-chain read — Task 5
- ✅ Frontend: remove `getLoanLiquidationThreshold` — Task 5
- ✅ Frontend: expired badge in `LoanStatusBadge` — Task 5
- ✅ Marketplace unchanged (filters by `status = 'pending'` — expired excluded automatically) — confirmed in design, no task needed

**Placeholder scan:** None found.

**Type consistency:** `ExpireLoanDto.expiredAt: Date` matches `loanService.expire()` parameter and maps to `p_expired_at: expiredAt.toISOString()` which matches the SQL function signature. `LoanExpired` event args `(loanId, borrower, timestamp)` match `handleLoanExpired` signature.
