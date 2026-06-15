# Borrow Flow: Interest Rate & Due Date — Design

**Date:** 2026-06-15
**Status:** Approved (design), pending spec review
**Scope:** Add a borrower-set interest rate and a loan deadline to the borrow flow, across contract, web, API, and database.

## Problem

The borrow flow at `/borrow` does not let borrowers set an interest rate or a deadline. The web client hardcodes `0, 0` for the contract's `interestRateBps` and `durationSeconds` params (`apps/web/src/lib/wallet/vouchVault.ts`). Much of the downstream plumbing already exists but is unused: the `VouchVault` `Loan` struct carries `interestRateBps` and `durationSeconds`, and the `loans` table has `interestRate`, `duration`, and `dueAt` columns.

A loan is created by the borrower (collateral locked immediately) but is not active until a lender funds it. The deadline therefore cannot be a fixed point set at creation — the clock must start at funding.

## Decisions

These were settled during brainstorming:

1. **Interest is time-respective (APR), not flat.** `interestRateBps` is reinterpreted as an **annual** rate. This is a semantic change from the current flat-fee behavior.
2. **Accrual is per-day simple interest, capped at the loan duration.** No compounding. Interest stops growing once the loan reaches its due date (`fundedAt + durationSeconds`).
3. **The deadline is a duration that starts at funding, plus a separate funding window.**
   - `durationSeconds` — loan term; `dueAt = fundedAt + durationSeconds`.
   - `fundWindowSeconds` → `fundDeadline = createdAt + fundWindowSeconds` — how long lenders have to fund before the request is no longer fundable.
4. **Funding past the deadline is blocked on-chain.** `fundLoan` / `fundLoanWithERC20` revert if `block.timestamp > fundDeadline`. Cleanup of stale loans is handled off-chain by the planned keeper/liquidation bot — no automation inside the borrow flow.
5. **Borrowers can cancel a pending (unfunded) request at any time** and reclaim locked collateral — not gated on the funding window. This is new contract surface; no equivalent exists today (`withdraw` only drains a separate `deposits` balance).
6. **Repayment uses interest-first amortization (Approach A).** Each payment covers accrued interest first, then principal. Collateral is released proportional to **principal repaid**, keeping collateral release stable even as `totalDue` grows day to day. Partial payments are fully supported.

## Architecture

Four layers change. The contract is the source of truth; web/API/DB mirror its semantics.

### 1. Smart Contract (`packages/contracts/contracts/VouchVault.sol`)

**Struct changes (`Loan`):**
- `interestRateBps` (existing, uint16) — reinterpreted as **annual** rate in basis points (500 = 5% APR).
- `durationSeconds` (existing, uint256) — now **load-bearing**: drives the interest cap and `dueAt`.
- `fundDeadline` (new, uint256) — absolute timestamp; set at creation to `createdAt + fundWindowSeconds`.
- `principalRepaid` (new, uint256) — principal repaid so far, tracked separately from interest for collateral-release math.

**Creation params:** `createLoan` and `createLoanWithERC20` gain a `fundWindowSeconds` param (alongside the existing `interestRateBps`, `durationSeconds`). `fundDeadline` is computed and stored at creation.

**Accrued interest helper (view):**
```
accruedInterest(loan):
  if !funded: return 0
  cappedNow   = min(block.timestamp, fundedAt + durationSeconds)
  elapsedDays = (cappedNow - fundedAt) / 1 days        // floored to whole days
  return principal * interestRateBps * elapsedDays / (10000 * 365)
```
`totalDue = principal + accruedInterest(loan)` at any given moment.

**Repayment rewrite (`repayLoan` + `repayLoanWithERC20`) — interest-first (Approach A):**
- Compute `accrued = accruedInterest(loan)`; `totalOwedNow = principal + accrued - amountRepaid`.
- Reject `payment > totalOwedNow`.
- Apply payment to outstanding accrued interest first; remainder reduces principal and increments `principalRepaid`.
- `collateralToRelease = collateralAmount * principalRepaid / principalAmount`, minus already-released. On full principal repayment, return all remaining collateral (dust-free), set `repaid = true`, `active = false`, `collateralLocked = false`.
- Forward payment to lender; return collateral in original form (ETH or ERC20).
- Emit `LoanRepaid` on full repayment (with the actual accrued interest), else `LoanPartiallyRepaid`.

**Funding window:** `fundLoan` / `fundLoanWithERC20` add `require(block.timestamp <= loan.fundDeadline, "Funding window passed")`.

**Pending cancel (new `cancelLoan(loanId)`):**
- Requires `!loan.funded && loan.active && msg.sender == loan.borrower`.
- Marks loan inactive, unlocks collateral, returns it in original form.
- Emits new `LoanCancelled` event. Available any time before funding.

**View update:** `getRepaymentDetails` returns live accrued interest, `dueAt` (or `durationSeconds` + `fundedAt`), and `fundDeadline`.

**Test impact:** existing tests assume flat interest and an unenforced duration. They will be rewritten to cover per-day accrual, the cap, the funding-window revert, interest-first partial repayment, and cancel.

### 2. Web (`apps/web`)

**`src/lib/components/ui/CreateLoan.svelte`:** three new inputs —
- Interest Rate (APR) — numeric %, validated `≥ 0` and within a sane cap.
- Loan duration — preset select (e.g. 7 / 14 / 30 / 60 / 90 days) with a "Custom" option that reveals a numeric day input; starts at funding.
- Fund within — preset select (e.g. 1 / 3 / 7 / 14 days) with a "Custom" option that reveals a numeric day input; the funding window.

Both selects expose presets for the common case and a custom day-count fallback. Custom values are validated as positive integers (`> 0` days); no upper cap. Fund window and duration are independent.

**`src/lib/wallet/vouchVault.ts`:** stop hardcoding `0, 0`. `createLoan` / `createEthLoan` / `createErc20Loan` accept and forward `interestRateBps`, `durationSeconds`, `fundWindowSeconds` (convert APR% → bps, days → seconds). Add a `cancelLoan(loanId)` wrapper.

**`src/lib/loans/loanMath.ts`:** add a per-day accrued-interest helper mirroring the contract (capped at duration) so dashboard figures match on-chain charges. `formatDueDateLabel` already works off `dueAt` — feed it the real value.

**Display:** show interest rate, duration, and the live "Due in Nd / Overdue" label on loan cards (dashboard, marketplace); add a "Cancel request" button on the borrower's own pending loans.

**Marketplace:** exclude expired-unfunded requests (`status = 'pending' AND fundDeadline <= now()`) — they are no longer fundable on-chain.

### 3. Database (`supabase/migrations`)

- New column `fundDeadline timestamptz` on `loans`.
- Repurpose `duration` to store the loan term; populate `dueAt = fundedAt + duration` at funding.
- `interestRate` now stores APR. Keep the existing WAD/bps convention already used by `loanMath.ts` and the contract; document the unit in the migration.
- `cancelled` status enum value already exists — reused for the cancel path.

### 4. API (`apps/api/src/loans`)

- **`CreateLoanDto` + `create_loan_with_transaction` RPC:** add `interestRateBps`, `durationSeconds`, `fundWindowSeconds`; compute and persist `fundDeadline = createdAt + fundWindowSeconds`. Source values from the `LoanCreated` event (confirm event carries them; extend the event if not).
- **`fund_loan_with_transaction` RPC:** in addition to setting `status='active'` and `startAt`, set `dueAt = fundedAt + duration`.
- **Cancel path:** new endpoint + `cancel_loan_with_transaction` RPC; on `LoanCancelled` event set `status='cancelled'`, `cancelledAt`.
- **Marketplace query:** filter `status = 'pending' AND fundDeadline > now()`. (Exact location — loans service or Supabase view — to be confirmed during implementation.)
- **Repayment recording:** keep `repay` / `partialRepay` RPCs and `record_partial_repayment`; ensure the recorded `interestAmount` / principal split reflects the contract's accrued (time-based) interest rather than a flat figure.

## Data Flow

1. **Create:** borrower submits amount, collateral, APR, duration, fund window → `createLoan(..., interestRateBps, durationSeconds, fundWindowSeconds)` locks collateral, stores `fundDeadline = createdAt + fundWindowSeconds`, emits `LoanCreated` → listener persists to `loans` (status `pending`).
2. **Marketplace:** shows only `pending` loans with `fundDeadline > now()`.
3. **Fund:** lender calls `fundLoan` (reverts if past `fundDeadline`) → sets `fundedAt`, `funded`, status `active`; RPC sets `dueAt = fundedAt + duration`.
4. **Accrue:** interest grows per-day from `fundedAt`, capped at `dueAt`.
5. **Repay (full or partial):** payment covers accrued interest first, then principal; collateral released ∝ principal repaid. Full principal repayment closes the loan and returns remaining collateral.
6. **Cancel:** borrower calls `cancelLoan` on an unfunded loan anytime → collateral returned, status `cancelled`.

## Error Handling

- Funding past `fundDeadline` reverts on-chain (`"Funding window passed"`).
- Cancel only allowed on unfunded, active loans owned by the caller.
- Repayment rejects overpayment (`payment > totalOwedNow`).
- Collateral release floored by integer math; final payment returns dust.

## Testing

- **Contract:** per-day accrual correctness; cap at due date; funding-window revert; interest-first partial repayment with proportional collateral release; full-repayment dust return; cancel returns collateral and blocks post-funding.
- **Web:** form validation; APR→bps and days→seconds conversion; dashboard figures match contract; marketplace excludes expired-unfunded.
- **API/DB:** create persists new fields; fund sets `dueAt`; cancel sets status; marketplace query filters expired.

## Out of Scope

- Compounding interest.
- Late-payment penalties / interest accrual past the due date (accrual is capped at duration).
- Keeper/liquidation bot itself (separate effort; this design only blocks late funding on-chain and leaves stale-loan cleanup to it).
