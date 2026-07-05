# Design: Loan Expiry + Pre-Funding Health Factor Check

**Branch:** `feat/expire-loan-hf-check`  
**Date:** 2026-07-04

## Overview

Two related changes:

1. **`getHealthFactor` supports unfunded loans** — uses `requestedPrincipalAmount` as debt when the loan hasn't been funded yet. Enables an authoritative on-chain HF read for pending loans everywhere.
2. **Pre-funding HF check in `fundLoan` / `fundLoanWithERC20`** — rejects funding an already-undercollateralized loan at the contract level.
3. **`expireLoan`** — permissionless function to expire a pending loan whose `fundDeadline` has passed, returning collateral to the borrower.

The keeper bot (future work) will call `expireLoan`. This spec covers the contract, DB, API listener, and frontend changes only.

---

## Smart Contract (`VouchVault.sol`)

### 1. `getHealthFactor` — unfunded loan support

Remove `require(loan.funded, "Loan not funded")`. For unfunded loans, use `requestedPrincipalAmount` as the debt:

```solidity
uint256 debt = loan.funded
    ? loan.principalAmount + _currentInterestOwed(loan) - loan.amountRepaid
    : loan.requestedPrincipalAmount;
require(debt > 0, "No remaining debt");
```

`_currentInterestOwed` returns 0 for unfunded loans already (guards on `!loan.funded`), so no other changes needed. The `require(!loan.repaid)` guard stays.

### 2. HF check in `fundLoan` / `fundLoanWithERC20`

After existing guards, before state mutation:

```solidity
require(getHealthFactor(loanId) >= 1e18, "Loan is undercollateralized");
```

This is a self-call (`public view`), which is valid in Solidity. Gas cost is acceptable since funding is a lender action, not high-frequency.

### 3. `expireLoan(uint256 loanId)` — new permissionless function

```
Conditions:
  - loan.active == true
  - loan.funded == false
  - block.timestamp > loan.fundDeadline

Actions:
  - loan.active = false
  - loan.collateralLocked = false
  - loan.collateralReleased = loan.collateralAmount
  - Return full collateral to borrower (ETH or ERC20, same logic as cancelLoan)
  - If ETH: lockedEthCollateral[borrower] -= amount
  - emit LoanExpired(loanId, borrower, block.timestamp)
```

New event:
```solidity
event LoanExpired(uint256 indexed loanId, address indexed borrower, uint256 timestamp);
```

Permissionless — anyone can call it once the deadline has passed. No caller incentive in this iteration.

---

## Database

### Migration 1: add `expired` to enum + `expiredAt` column

```sql
ALTER TYPE "loanStatus" ADD VALUE 'expired';
ALTER TABLE loans ADD COLUMN "expiredAt" timestamptz;
```

### Migration 2: `expire_loan_with_transaction` function

Mirrors `cancel_loan_with_transaction` exactly:
- Resolves chain → loan by `onChainLoanId` + `networkId` + `contractAddress`
- Inserts a `withdrawal` transaction for the collateral return (same reasoning as cancellation)
- `UPDATE loans SET status = 'expired', "expiredAt" = p_expired_at WHERE id = v_loan_id AND status = 'pending'`
- Idempotent: no-op if already expired
- `SECURITY DEFINER`, `GRANT EXECUTE TO service_role`

Parameters: same as `cancel_loan_with_transaction` except `p_expired_at` instead of `p_cancelled_at`.

---

## API — Blockchain Listener

### DTO

`ExpireLoanDto` — mirrors `CancelLoanDto`, field `expiredAt: Date` instead of `cancelledAt`.

### `LoansService.expire()`

Calls `expire_loan_with_transaction` RPC. Mirrors `LoansService.cancel()`.

### `BlockchainListenerService`

In `setupEventListener`, add alongside `LoanCancelled`:

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

`handleLoanExpired` — mirrors `handleLoanCancelled`, calls `loanService.expire()`.

TypeChain types are auto-generated from the contract ABI after recompile — `contract.getEvent('LoanExpired')` will resolve once the contract is rebuilt.

---

## Frontend

### `vouchVault.ts`

- Remove `getLoanLiquidationThreshold` (no longer needed).
- `getHealthFactor` already exists and works off-chain via `eth_call` — no changes needed here.

### `LoanRepayRow.svelte`

Replace the pending loan `$effect` (which manually called `getLoanLiquidationThreshold` + `calculateHealthFactor`) with a direct `getHealthFactor` RPC call — same pattern as active loans. The `~` approximation prefix is removed since it's now an authoritative on-chain read.

The `projectedHf` state and `calculateHealthFactor` import are removed from this component.

### `LoanStatusBadge.svelte`

Add `isExpired` prop + `expired` badge (muted/grey styling, similar to cancelled).

### `LoanRepayRow.svelte` — expired row

- `isExpired` derived from `loan.status === 'expired'`
- No action button (collateral already returned, terminal state)
- Faded appearance like repaid rows (`opacity-60`)

### Marketplace

No changes needed. The query already filters `.eq('status', 'pending')` — expired loans are excluded automatically. The realtime subscription re-runs `fetchLoans()` on any loan change, which re-applies the filter.

---

## Out of Scope

- Keeper bot implementation (will call `expireLoan` as a separate future task)
- Frontend pre-funding HF warning button (tracked in Issue #73)
- Lend offer deadline expiry (future, same pattern)
- Caller incentives for `expireLoan`
