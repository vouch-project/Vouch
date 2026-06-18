# Borrow Interest Rate & Due Date — Off-Chain Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the contract's interest rate, loan duration, funding window, and loan cancellation through the database, API, and web app, so borrowers set an APR + duration + fund window when creating a loan, expired-unfunded loans are hidden from the marketplace, and borrowers can cancel pending loans to reclaim collateral.

**Architecture:** The smart contract (Plan 1, already merged on this branch) is the source of truth. The blockchain listener reads on-chain loan data into Postgres via RPC functions. The web app calls the contract through `ethers` wrappers and reads loan state from Supabase. This plan: (1) adds DB columns + new cancel RPC and extends the create/fund RPCs; (2) extends the API DTOs/service/listener (including a new `LoanCancelled` handler); (3) adds form inputs + a `cancelLoan` wallet wrapper + marketplace filtering + display in the web app.

**Tech Stack:** Supabase/Postgres (SQL migrations), NestJS + Jest (`apps/api`), SvelteKit + Svelte 5 runes (`apps/web`), ethers v6, `@vouch/database-types` (generated types).

**Spec:** `docs/superpowers/specs/2026-06-15-borrow-interest-duedate-design.md`
**Plan 1 (contract, done):** `docs/superpowers/plans/2026-06-16-borrow-interest-duedate-contract.md`

## Decisions (settled with the user)

- **Interest rate unit in DB:** store the contract's value directly as **annual basis points** (e.g. 500 = 5% APR). The listener stores `interestRateBps` unchanged. Display divides by 100. `loanMath.ts` and the marketplace render are updated to the annual-bps model (away from the old WAD `1e18 = 1%` convention).
- **Cancel button placement:** BOTH the dashboard loan row (`LoanRepayRow.svelte`, shown when pending) AND the marketplace "Your loan" slot.

## Key facts from exploration (current state)

- `loans` table HAS: `interestRate` (uint256/numeric, nullable, **never populated**), `duration` (interval, nullable, never populated), `dueAt` (timestamptz, nullable, never populated), `fundedAt`, `startAt`, `status` (`loanStatus` enum), `cancelledAt`. MISSING: `fundDeadline`, `principalRepaid`.
- `loanStatus` enum already includes `'cancelled'`.
- `LoanCreated` event does NOT carry interestRateBps/durationSeconds/fundDeadline. The listener must read them from the contract `loans(loanId)` getter after the event, OR via `getRepaymentDetails`. **This plan reads `getRepaymentDetails(loanId)`** (returns interestRateBps, durationSeconds, fundDeadline among the 7-tuple) inside the listener's `handleLoanCreated`.
- Contract `getRepaymentDetails` 7-tuple: `(interestRateBps uint16, durationSeconds uint256, repaid bool, totalDue uint256, amountRepaid uint256, remaining uint256, fundDeadline uint256)`.
- `createLoan(principalToken, principalAmount, interestRateBps, durationSeconds, fundWindowSeconds)`; `createLoanWithERC20(token, amount, principalToken, principalAmount, interestRateBps, durationSeconds, fundWindowSeconds)`. `fundWindowSeconds` must be > 0.
- Web `createEthLoan`/`createErc20Loan` currently hardcode `0, 0` and are now arity-mismatched with the new ABI.
- Marketplace queries: `apps/web/src/routes/marketplace/+page.ts` and `+page.svelte` both `.eq('status','pending')` with no fund-deadline filter.

## File Structure

**Database (`supabase/migrations/`):** new timestamped migration files (use `YYYYMMDDHHMMSS_*.sql`; pick timestamps AFTER the latest existing migration `20260609000000`). One migration per concern:
- Add columns `fundDeadline timestamptz`, `principalRepaid` to `loans`.
- Replace `create_loan_with_transaction` to accept + store interest/duration/fundDeadline.
- Replace `fund_loan_with_transaction` to set `fundedAt` + `dueAt`.
- Add `cancel_loan_with_transaction`.

**API (`apps/api/src/loans/`):** extend `CreateLoanDto`; new `CancelLoanDto`; extend `LoansService.create`, add `LoansService.cancel`; `blockchain-listener.service.ts` extends `handleLoanCreated` (read `getRepaymentDetails`), adds `LoanCancelled` wiring + `handleLoanCancelled`. Update specs.

**Web (`apps/web/`):** `lib/wallet/vouchVault.ts` (fix createLoan signature, widen `RepaymentDetails`/`getRepaymentDetails`, add `cancelLoan`); `lib/components/ui/CreateLoan.svelte` (APR/duration/fund-window inputs); `lib/loans/loanMath.ts` (annual-bps model + per-day accrual helper); marketplace `+page.ts`/`+page.svelte` (filter + display + cancel); `lib/components/ui/LoanRepayRow.svelte` (cancel button when pending).

**Generated types:** regenerate `packages/database-types/src/generated.ts` after migrations via `pnpm db:generate:types`.

---

## Task 1: DB migration — add `fundDeadline` and `principalRepaid` columns

**Files:**
- Create: `supabase/migrations/20260610000000_loans_fund_deadline.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260610000000_loans_fund_deadline.sql`:

```sql
-- Funding window cutoff (createdAt + fundWindowSeconds) and cumulative principal repaid,
-- mirroring the on-chain VouchVault loan struct (V5 additions).
ALTER TABLE loans
ADD COLUMN IF NOT EXISTS "fundDeadline" timestamptz,
ADD COLUMN IF NOT EXISTS "principalRepaid" uint256;

-- Marketplace excludes expired-unfunded loans by filtering on fundDeadline; index it
-- alongside status for the common "pending and still fundable" query.
CREATE INDEX IF NOT EXISTS loans_fund_deadline_idx ON loans (status, "fundDeadline");
```

- [ ] **Step 2: Apply and verify**

Run: `cd "/Users/nirarad/Computer Science/vouch" && npx supabase db reset`
Expected: all migrations apply with no error; the reset output ends successfully. (`db reset` re-runs every migration against the local stack.)

- [ ] **Step 3: Confirm columns exist**

Run:
```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "\d loans" | grep -E "fundDeadline|principalRepaid"
```
Expected: two rows showing `fundDeadline | timestamp with time zone` and `principalRepaid | numeric`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260610000000_loans_fund_deadline.sql
git commit -m "feat(db): add fundDeadline and principalRepaid columns to loans"
```

---

## Task 2: DB migration — store interest/duration/fundDeadline in `create_loan_with_transaction`

**Files:**
- Create: `supabase/migrations/20260610000100_create_loan_with_interest.sql`
- Reference (read the current definition to preserve its body): `supabase/migrations/20260324000000_create_loan_function.sql`

- [ ] **Step 1: Read the current function to copy its body verbatim**

Run: `cat supabase/migrations/20260324000000_create_loan_function.sql`
You MUST preserve every existing line of the function body (token lookups, the transaction insert, the loans insert, the return). You are only ADDING three parameters and three columns. Do NOT change existing behavior.

- [ ] **Step 2: Write the replacement migration**

Create `supabase/migrations/20260610000100_create_loan_with_interest.sql`. Use `CREATE OR REPLACE FUNCTION` with the SAME function name and the SAME parameters as the original PLUS three new trailing params. Copy the entire existing body, and in the `INSERT INTO loans (...)` add the three new columns. The new params:
- `p_interest_rate_bps integer DEFAULT 0`
- `p_duration_seconds bigint DEFAULT 0`
- `p_fund_deadline timestamptz DEFAULT NULL`

In the loans INSERT, add columns `"interestRate"`, `duration`, `"fundDeadline"` with values:
- `"interestRate"` ← `p_interest_rate_bps`
- `duration` ← `make_interval(secs => p_duration_seconds)`
- `"fundDeadline"` ← `p_fund_deadline`

Concretely, the migration looks like (fill the body from Step 1 — shown here with the loans INSERT extended; KEEP all other statements from the original exactly):

```sql
CREATE OR REPLACE FUNCTION create_loan_with_transaction(
  p_network_id text,
  p_collateral_token_address address,
  p_contract_address address,
  p_on_chain_loan_id uint256,
  p_borrower_address address,
  p_collateral_amount text,
  p_requested_principal_token_address address,
  p_requested_principal_amount text,
  p_collateral_tx_hash text,
  p_collateral_block_number uint256,
  p_collateral_block_hash text,
  p_log_index uint256,
  p_collateral_locked_at timestamptz,
  p_interest_rate_bps integer DEFAULT 0,
  p_duration_seconds bigint DEFAULT 0,
  p_fund_deadline timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
-- PRESERVE the original's volatility/security qualifiers (e.g. SECURITY DEFINER) if present
AS $$
DECLARE
  -- COPY all DECLARE lines from the original function verbatim
BEGIN
  -- COPY all statements from the original function verbatim, EXCEPT extend the
  -- `INSERT INTO loans (...) VALUES (...)` to also set the three new columns:
  --
  --   INSERT INTO loans (
  --     "onChainLoanId", "borrowerAddress", "collateralAmount", "collateralTokenId",
  --     "principalTokenId", "principalAmount", "chainId",
  --     "interestRate", duration, "fundDeadline"
  --   ) VALUES (
  --     ... existing values ...,
  --     p_interest_rate_bps,
  --     make_interval(secs => p_duration_seconds),
  --     p_fund_deadline
  --   ) RETURNING id INTO <existing_var>;
  --
  -- Keep the original RETURN statement.
END;
$$;
```

IMPORTANT: Because the three new params have DEFAULTs and are appended last, the existing `LoansService.create` call (which passes the original params by name) keeps working until Task 5 updates it. Match the original's `LANGUAGE`/`SECURITY` qualifiers exactly — read them in Step 1.

- [ ] **Step 3: Apply and verify**

Run: `cd "/Users/nirarad/Computer Science/vouch" && npx supabase db reset`
Expected: success.

Then verify the function signature includes the new params:
```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "\df create_loan_with_transaction"
```
Expected: argument list includes `p_interest_rate_bps`, `p_duration_seconds`, `p_fund_deadline`.

- [ ] **Step 4: Functional check (insert path still works + new columns set)**

Run a direct RPC-style call with the new params (adapt chain/token UUIDs to seeded values if the function looks them up by address — if so, use addresses that exist in your local seed; otherwise this smoke test can be skipped in favor of the API spec in Task 5):
```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT proname FROM pg_proc WHERE proname = 'create_loan_with_transaction';"
```
Expected: one row. (Full insert behavior is covered by the API integration in Task 5; this step just confirms the function is installed.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260610000100_create_loan_with_interest.sql
git commit -m "feat(db): store interest rate, duration, and fundDeadline on loan creation"
```

---

## Task 3: DB migration — set `fundedAt` + `dueAt` in `fund_loan_with_transaction`

**Files:**
- Create: `supabase/migrations/20260610000200_fund_loan_set_due_at.sql`
- Reference: `supabase/migrations/20260427000000_fund_loan_with_transaction.sql`

- [ ] **Step 1: Read the current function**

Run: `cat supabase/migrations/20260427000000_fund_loan_with_transaction.sql`
The current UPDATE sets `status='active'`, `"lenderAddress"=p_lender_address`, `"startAt"=p_funded_at`. It does NOT set `fundedAt` or `dueAt`. Preserve everything; you are only extending the UPDATE.

- [ ] **Step 2: Write the replacement migration**

Create `supabase/migrations/20260610000200_fund_loan_set_due_at.sql` with `CREATE OR REPLACE FUNCTION fund_loan_with_transaction(...)` — SAME signature as the original (no new params needed; `p_funded_at` already exists). Copy the body verbatim, but change the loans UPDATE to also set `"fundedAt"` and compute `"dueAt"` from the stored `duration`:

```sql
  -- existing UPDATE, extended:
  UPDATE loans
  SET status = 'active',
      "lenderAddress" = p_lender_address,
      "startAt" = p_funded_at,
      "fundedAt" = p_funded_at,
      "dueAt" = CASE
                  WHEN duration IS NOT NULL AND duration > interval '0'
                  THEN p_funded_at + duration
                  ELSE NULL
                END,
      "updatedAt" = now()
  WHERE <existing WHERE clause from the original — copy it exactly>;
```

Keep the rest of the function (the transaction-row insert, any guards, RETURN) exactly as in the original. Match `LANGUAGE`/`SECURITY` qualifiers.

- [ ] **Step 3: Apply and verify**

Run: `cd "/Users/nirarad/Computer Science/vouch" && npx supabase db reset`
Expected: success.
```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='fund_loan_with_transaction';" | grep -E "dueAt|fundedAt"
```
Expected: the function body shows it sets `"fundedAt"` and `"dueAt"`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260610000200_fund_loan_set_due_at.sql
git commit -m "feat(db): set fundedAt and dueAt when a loan is funded"
```

---

## Task 4: DB migration — add `cancel_loan_with_transaction`

**Files:**
- Create: `supabase/migrations/20260610000300_cancel_loan_with_transaction.sql`
- Reference (for the transaction-row insert pattern + guard style): `supabase/migrations/20260608204418_repay_loan_with_transaction.sql`

- [ ] **Step 1: Read the repay function for the established pattern**

Run: `cat supabase/migrations/20260608204418_repay_loan_with_transaction.sql`
Note how it: looks up the chain by network id, looks up the loan by `("onChainLoanId", "chainId", contract)`, inserts a transaction row, updates the loan status idempotently (guards on current status), and is `SECURITY DEFINER`. Mirror this structure for cancel.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260610000300_cancel_loan_with_transaction.sql`. The function marks an unfunded/pending loan cancelled and records the on-chain event. Match the repay function's parameter naming/lookup conventions (adapt to the actual columns/joins used there — read Step 1 carefully and reuse its exact chain/loan lookup):

```sql
CREATE OR REPLACE FUNCTION cancel_loan_with_transaction(
  p_network_id text,
  p_contract_address address,
  p_on_chain_loan_id uint256,
  p_borrower_address address,
  p_tx_hash text,
  p_block_number uint256,
  p_block_hash text,
  p_log_index uint256,
  p_cancelled_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_chain_id uuid;
  v_loan_id uuid;
BEGIN
  -- Resolve chain (copy the lookup style from repay_loan_with_transaction).
  SELECT id INTO v_chain_id FROM chains WHERE <chain lookup matching repay fn>;
  IF v_chain_id IS NULL THEN
    RAISE EXCEPTION 'Chain not found for network %', p_network_id;
  END IF;

  -- Resolve loan by on-chain id + chain (+ contract if the repay fn does so).
  SELECT id INTO v_loan_id FROM loans
   WHERE "onChainLoanId" = p_on_chain_loan_id AND "chainId" = v_chain_id;
  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'Loan not found for on-chain id %', p_on_chain_loan_id;
  END IF;

  -- Record the cancellation as a transaction row (mirror the repay fn's insert columns;
  -- use the transaction type the schema defines — check the transactions table / enum used
  -- by repay/partial. If a 'cancellation' type is not available, reuse the schema's generic
  -- type as repay does, keeping the same NOT NULL columns populated).
  INSERT INTO transactions (
    <same columns the repay fn inserts: loan id, chain id, tx hash, block number/hash,
     log index, type, timestamp, addresses/amounts as applicable>
  ) VALUES (
    <corresponding values; amount columns 0/NULL as the schema allows>
  )
  ON CONFLICT DO NOTHING; -- only if the repay fn uses an idempotency guard; match it

  -- Idempotent status update: only cancel a still-pending loan.
  UPDATE loans
  SET status = 'cancelled',
      "cancelledAt" = p_cancelled_at,
      "updatedAt" = now()
  WHERE id = v_loan_id AND status = 'pending';
END;
$$;
```

NOTE: The exact `transactions` insert columns and the transaction-type value MUST match what `repay_loan_with_transaction` and `record_partial_repayment` use (read both). If the schema has a transaction-type enum without a cancel value, prefer adding the appropriate value in THIS migration only if the other functions demonstrate that pattern; otherwise reuse the existing generic type they use. Do not invent columns.

- [ ] **Step 3: Apply and verify**

Run: `cd "/Users/nirarad/Computer Science/vouch" && npx supabase db reset`
Expected: success.
```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "\df cancel_loan_with_transaction"
```
Expected: one row with the 9 params above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260610000300_cancel_loan_with_transaction.sql
git commit -m "feat(db): add cancel_loan_with_transaction RPC"
```

---

## Task 5: Regenerate DB types + extend `CreateLoanDto` and `LoansService.create`

**Files:**
- Regenerate: `packages/database-types/src/generated.ts`
- Modify: `apps/api/src/loans/dto/create-loan.dto.ts`
- Modify: `apps/api/src/loans/loans.service.ts:13-44`
- Modify (tests): `apps/api/src/loans/loans.service.spec.ts`

- [ ] **Step 1: Regenerate generated types**

Ensure Supabase is running (`npx supabase start` if needed), then:
Run: `cd "/Users/nirarad/Computer Science/vouch" && pnpm db:generate:types`
Expected: `packages/database-types/src/generated.ts` now includes `fundDeadline` and `principalRepaid` on the `loans` Row/Insert/Update, and the package builds.

Verify:
```bash
grep -E "fundDeadline|principalRepaid" packages/database-types/src/generated.ts
```
Expected: matches present.

- [ ] **Step 2: Write/extend the failing service test**

Open `apps/api/src/loans/loans.service.spec.ts`. Find the existing test for `create` (it mocks `supabaseService.client.rpc` and asserts the params passed). Extend it (or add a new test) to assert the new params are forwarded. Add fields to the DTO object the test passes and assert the rpc args include them:

```typescript
    // within the create() test, the DTO passed to service.create(...) gains:
    interestRateBps: 500,
    durationSeconds: 2592000, // 30 days
    fundWindowSeconds: 604800, // 7 days

    // and the expected rpc payload gains:
    p_interest_rate_bps: 500,
    p_duration_seconds: 2592000,
    p_fund_deadline: expect.any(String), // ISO string = collateralLockedAt + fundWindowSeconds
```

If the existing test asserts the full rpc payload via `toHaveBeenCalledWith`, update that expectation object to include the three new `p_*` keys. Match the spec file's existing mocking style exactly (read it first).

- [ ] **Step 3: Run the test, confirm failure**

Run: `cd apps/api && pnpm test -- loans.service`
Expected: FAIL — service doesn't pass the new params yet (and DTO lacks the fields).

- [ ] **Step 4: Extend `CreateLoanDto`**

In `apps/api/src/loans/dto/create-loan.dto.ts`, add three fields (use existing decorators from the file — `@IsNumber()` for plain numbers):

```typescript
  @IsNumber()
  interestRateBps!: number;

  @IsNumber()
  durationSeconds!: number;

  @IsNumber()
  fundWindowSeconds!: number;
```

- [ ] **Step 5: Forward the new params in `LoansService.create`**

In `apps/api/src/loans/loans.service.ts`, the `create` method destructures `CreateLoanDto`. Add the new fields to the destructure and to the rpc payload. Compute `p_fund_deadline` as `collateralLockedAt + fundWindowSeconds` (the listener passes `collateralLockedAt` = the on-chain creation timestamp, and `fundDeadline = createdAt + fundWindowSeconds`). Add to the destructured params: `interestRateBps`, `durationSeconds`, `fundWindowSeconds`. Then in the rpc object add:

```typescript
        p_interest_rate_bps: createLoanDto.interestRateBps,
        p_duration_seconds: createLoanDto.durationSeconds,
        p_fund_deadline: new Date(
          collateralLockedAt.getTime() + createLoanDto.fundWindowSeconds * 1000,
        ).toISOString(),
```

NOTE: `interestRateBps`/`durationSeconds`/`fundWindowSeconds` are NOT in the `...createLoanDto` rest spread destructure target used for `loanId` etc.; verify how the method destructures (it pulls `collateralTokenAddress, networkId, contractAddress, collateralLockedAt` out and keeps the rest as `createLoanDto`). Since the new fields are accessed as `createLoanDto.interestRateBps` etc., they remain on the rest object — so you only need to add the three `p_*` lines to the rpc payload (and add them to the DTO in Step 4). Confirm by reading the method.

- [ ] **Step 6: Run the test, confirm pass**

Run: `cd apps/api && pnpm test -- loans.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/database-types/src/generated.ts apps/api/src/loans/dto/create-loan.dto.ts apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(api): capture interest rate, duration, and fund window on loan creation"
```

---

## Task 6: Listener reads on-chain terms in `handleLoanCreated`

**Files:**
- Modify: `apps/api/src/blockchain-listener/blockchain-listener.service.ts:210-246`
- Modify (tests): `apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts`

**Context:** `LoanCreated` does not carry interest/duration/fundWindow. The handler must read them from the contract. The handler has access to the `ethers.Contract` only in `setupEventListener`; `handleLoanCreated` currently does not receive the contract. We pass the needed values by calling `getRepaymentDetails(loanId)` on the contract. The cleanest minimal change: pass the `contract` (or the three derived values) into `handleLoanCreated`.

- [ ] **Step 1: Write the failing test**

Open `apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts`. Find the test(s) covering `handleLoanCreated` (or the LoanCreated wiring). Add/extend a test so that when a `LoanCreated` event is handled, the service:
1. calls the contract's `getRepaymentDetails(loanId)` (mock it to return a 7-tuple, e.g. `[500n, 2592000n, false, 0n, 0n, 0n, fundDeadlineBigInt]` — but note interestRateBps may come back as `bigint`/`number`; mirror what ethers returns for `uint16` — a `bigint`),
2. calls `loanService.create` with `interestRateBps`, `durationSeconds`, `fundWindowSeconds` derived correctly.

Key derivation: the contract returns `durationSeconds` and `fundDeadline` (absolute ts), and the event gives `timestamp` (createdAt). So `fundWindowSeconds = fundDeadline - timestamp`. Assert `loanService.create` is called with:
- `interestRateBps: 500` (Number)
- `durationSeconds: 2592000` (Number)
- `fundWindowSeconds: Number(fundDeadline - timestamp)`

Match the spec file's existing mock setup for the contract and `loanService`. If the existing spec constructs a mock contract object, add a `getRepaymentDetails: jest.fn().mockResolvedValue([...])` to it.

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/api && pnpm test -- blockchain-listener.service`
Expected: FAIL — handler doesn't read getRepaymentDetails or pass the new fields.

- [ ] **Step 3: Thread the contract into `handleLoanCreated` and read terms**

In `setupEventListener`, the `LoanCreated` `contract.on(...)` callback calls `this.handleLoanCreated(...)`. Add `contract` as an argument passed through (add a `contract: ethers.Contract` parameter to `handleLoanCreated`). Inside `handleLoanCreated`, before calling `this.loanService.create`, read terms:

```typescript
    let interestRateBps = 0;
    let durationSeconds = 0;
    let fundWindowSeconds = 0;
    try {
      const details = await contract.getRepaymentDetails(loanId);
      // 7-tuple: [interestRateBps, durationSeconds, repaid, totalDue, amountRepaid, remaining, fundDeadline]
      interestRateBps = Number(details[0]);
      durationSeconds = Number(details[1]);
      fundWindowSeconds = Number(BigInt(details[6]) - timestamp);
    } catch (error) {
      this.logger.error('Failed to read loan terms from contract', error);
    }
```

Then add `interestRateBps, durationSeconds, fundWindowSeconds` to the `this.loanService.create({...})` object.

IMPORTANT: `fundWindowSeconds` must be > 0 for the DB/contract invariant; since `fundDeadline = createdAt + fundWindowSeconds` and `timestamp` IS `createdAt`, the subtraction yields the original positive window. If `getRepaymentDetails` returns `fundDeadline` as a value where `details[6]` is already a bigint, `BigInt(details[6])` is safe; adjust to `details[6] as bigint` if the mock/types prefer.

Update the `setupEventListener` call site to pass `contract`:
```typescript
        this.enqueue(queueKey, () =>
          this.handleLoanCreated(
            loanId, borrower, collateralTokenAddress, collateralAmount,
            requestedPrincipalToken, requestedPrincipalAmount, timestamp,
            eventLog, network, config.contractAddress,
            contract, // NEW
          ),
        );
```
and add `contract: ethers.Contract` as the final parameter of `handleLoanCreated`.

- [ ] **Step 4: Run, confirm pass**

Run: `cd apps/api && pnpm test -- blockchain-listener.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/blockchain-listener/blockchain-listener.service.ts apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts
git commit -m "feat(api): read interest rate, duration, and fund window from chain on loan creation"
```

---

## Task 7: API cancel path — `CancelLoanDto`, `LoansService.cancel`, listener `LoanCancelled` handler

**Files:**
- Create: `apps/api/src/loans/dto/cancel-loan.dto.ts`
- Modify: `apps/api/src/loans/loans.service.ts`
- Modify: `apps/api/src/blockchain-listener/blockchain-listener.service.ts`
- Modify (tests): `apps/api/src/loans/loans.service.spec.ts`, `apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts`

- [ ] **Step 1: Write the failing service test**

In `loans.service.spec.ts`, add a test for a new `cancel(...)` method mirroring the `fund`/`repay` test style: it should call `rpc('cancel_loan_with_transaction', {...})` with the mapped params. Assert the payload:
```typescript
    {
      p_network_id: 'someNetwork',
      p_contract_address: '0x...', // asAddress applied
      p_on_chain_loan_id: '0',     // bigint -> string
      p_borrower_address: '0x...', // asAddress applied
      p_tx_hash: '0x...',
      p_block_number: '123',       // bigint/number -> string
      p_block_hash: '0x...',
      p_log_index: '0',
      p_cancelled_at: expect.any(String), // ISO
    }
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/api && pnpm test -- loans.service`
Expected: FAIL — no `cancel` method.

- [ ] **Step 3: Create `CancelLoanDto`**

Create `apps/api/src/loans/dto/cancel-loan.dto.ts`, mirroring `FundLoanDto`'s decorators (read it for exact imports/style):

```typescript
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CancelLoanDto {
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
  cancelledAt!: Date;
}
```

- [ ] **Step 4: Add `LoansService.cancel`**

In `apps/api/src/loans/loans.service.ts`, import `CancelLoanDto` and add a method mirroring `fund`:

```typescript
  async cancel({
    onChainLoanId,
    networkId,
    contractAddress,
    borrowerAddress,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    cancelledAt,
  }: CancelLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'cancel_loan_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_borrower_address: asAddress(borrowerAddress),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex.toString(),
        p_cancelled_at: cancelledAt.toISOString(),
      },
    );

    if (error) throw error;
  }
```

- [ ] **Step 5: Run the service test, confirm pass**

Run: `cd apps/api && pnpm test -- loans.service`
Expected: PASS.

- [ ] **Step 6: Write the failing listener test**

In `blockchain-listener.service.spec.ts`, add a test that a `LoanCancelled` event triggers `loanService.cancel(...)` with the right args (loanId→onChainLoanId, borrower→borrowerAddress, timestamp→cancelledAt as Date, plus tx fields from the event log). Mirror the existing `handleLoanFunded` test.

- [ ] **Step 7: Run, confirm failure**

Run: `cd apps/api && pnpm test -- blockchain-listener.service`
Expected: FAIL — no LoanCancelled wiring/handler.

- [ ] **Step 8: Add `LoanCancelled` wiring + `handleLoanCancelled`**

In `setupEventListener`, after the `LoanPartiallyRepaid` block, add:

```typescript
    void contract.on(
      'LoanCancelled',
      (
        loanId: bigint,
        borrower: string,
        timestamp: bigint,
        { log: eventLog }: ethers.ContractEventPayload,
      ) => {
        this.enqueue(queueKey, () =>
          this.handleLoanCancelled(
            loanId,
            borrower,
            timestamp,
            eventLog,
            network,
            config.contractAddress,
          ),
        );
      },
    );
```

Then add the handler (mirror `handleLoanFunded`):

```typescript
  private async handleLoanCancelled(
    loanId: bigint,
    borrower: string,
    timestamp: bigint,
    {
      transactionHash,
      blockNumber,
      blockHash,
      index: logIndex,
    }: ethers.EventLog,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.cancel({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        borrowerAddress: borrower,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        cancelledAt: new Date(Number(timestamp) * 1000),
      });
      this.logger.log(`Loan ${loanId.toString()} cancelled by ${borrower}`);
    } catch (error) {
      this.logger.error('Failed to cancel loan in DB', error);
    }
  }
```

- [ ] **Step 9: Run listener tests + full API suite**

Run: `cd apps/api && pnpm test -- blockchain-listener.service && pnpm test`
Expected: PASS (all API tests green).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/loans/dto/cancel-loan.dto.ts apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts apps/api/src/blockchain-listener/blockchain-listener.service.ts apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts
git commit -m "feat(api): handle LoanCancelled events and record cancellations"
```

---

## Task 8: Web wallet wrapper — fix `createLoan` signature, widen `getRepaymentDetails`, add `cancelLoan`

**Files:**
- Modify: `apps/web/src/lib/wallet/vouchVault.ts`

- [ ] **Step 1: Extend `createEthLoan` / `createErc20Loan` / `createLoan` to take interest, duration, fund window**

In `apps/web/src/lib/wallet/vouchVault.ts`:

`createEthLoan` (currently passes `0, 0`) — add params and pass all three on-chain args:
```typescript
const createEthLoan = async (
  contract: ethers.Contract,
  collateralAmount: string,
  principalToken: Token,
  principalAmount: string,
  interestRateBps: number,
  durationSeconds: number,
  fundWindowSeconds: number,
): Promise<ethers.TransactionResponse> => {
  const value = ethers.parseEther(collateralAmount);
  const principalTokenAddress = isNativeToken(principalToken) ? ethers.ZeroAddress : principalToken.address;
  const principalAmountParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
  return contract.createLoan(
    principalTokenAddress,
    principalAmountParsed,
    interestRateBps,
    durationSeconds,
    fundWindowSeconds,
    { value },
  );
};
```

`createErc20Loan` — same three params added, passed as the final three args (before there is no overrides object for ERC20):
```typescript
  return contract.createLoanWithERC20(
    token.address,
    amount,
    principalTokenAddress,
    principalAmountParsed,
    interestRateBps,
    durationSeconds,
    fundWindowSeconds,
  );
```
(Add `interestRateBps: number, durationSeconds: number, fundWindowSeconds: number` to its signature.)

`createLoan` (the exported wrapper) — add the three params and forward them to both branches:
```typescript
export const createLoan = async (
  collateralAmount: string,
  collateralToken: Token,
  principalToken: Token,
  principalAmount: string,
  interestRateBps: number,
  durationSeconds: number,
  fundWindowSeconds: number,
): Promise<CreateLoanResult> => {
  const contract = await getVouchVaultContract();
  const tx = await (isNativeToken(collateralToken)
    ? createEthLoan(contract, collateralAmount, principalToken, principalAmount, interestRateBps, durationSeconds, fundWindowSeconds)
    : createErc20Loan(contract, collateralToken, collateralAmount, principalToken, principalAmount, interestRateBps, durationSeconds, fundWindowSeconds));
  // ... rest unchanged (receipt parse for onChainLoanId) ...
};
```

- [ ] **Step 2: Widen `RepaymentDetails` + `getRepaymentDetails` for the 7-tuple**

Add `fundDeadline` to the type and reader:
```typescript
export type RepaymentDetails = {
  interestRateBps: number;
  durationSeconds: bigint;
  repaid: boolean;
  totalDue: bigint;
  amountRepaid: bigint;
  remaining: bigint;
  fundDeadline: bigint;
};
```
In `getRepaymentDetails`, add:
```typescript
    fundDeadline: result[6] as bigint,
```

- [ ] **Step 3: Add a `cancelLoan` wrapper**

After `fundLoan`, add:
```typescript
/**
 * Cancel an unfunded loan and reclaim collateral. Only the borrower may call this on-chain.
 * @param onChainLoanId - The on-chain uint256 loan ID.
 */
export const cancelLoan = async (onChainLoanId: bigint): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const tx: ethers.TransactionResponse = await contract.cancelLoan(onChainLoanId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && pnpm check`
Expected: no NEW type errors from this file. (It will surface that `CreateLoan.svelte` now calls `createLoan` with too few args — that's fixed in Task 9. If `pnpm check` fails ONLY on `CreateLoan.svelte` arg count, that's expected; proceed to Task 9 and re-check together. If it fails inside `vouchVault.ts` itself, fix it.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/wallet/vouchVault.ts
git commit -m "feat(web): pass interest/duration/fund-window to createLoan, add cancelLoan, widen repayment details"
```

---

## Task 9: Web loanMath — annual-bps model + per-day accrual helper

**Files:**
- Modify: `apps/web/src/lib/loans/loanMath.ts`

**Context:** The DB now stores `interestRate` as ANNUAL basis points (e.g. 500 = 5% APR), NOT the old WAD `1e18 = 1%`. `loanMath` must reflect this and provide a per-day capped accrual matching the contract.

- [ ] **Step 1: Rewrite the interest helpers to the annual-bps model**

Replace the WAD-based constants/helpers. New `loanMath.ts` core:

```typescript
/**
 * Pure helpers for deriving loan repayment figures.
 *
 * `loans.interestRate` is stored as the contract's ANNUAL interest rate in basis points
 * (e.g. 500 = 5% APR). Interest accrues per whole day, simple (no compounding), capped at
 * the loan duration — mirroring VouchVault._accruedInterest:
 *   accrued = principal * bps * elapsedDays / (10000 * 365)
 * All money math stays in bigint to avoid precision loss.
 */
const BPS_DENOMINATOR = 10000n;
const DAYS_PER_YEAR = 365n;
const SECONDS_PER_DAY = 86400n;

/** Whole days elapsed between funding and `now`, capped at the loan duration. */
const cappedElapsedDays = (fundedAtMs: number, durationSeconds: bigint, nowMs: number): bigint => {
  if (durationSeconds <= 0n) return 0n;
  const dueAtMs = fundedAtMs + Number(durationSeconds) * 1000;
  const cappedNowMs = Math.min(nowMs, dueAtMs);
  const elapsedSeconds = BigInt(Math.max(0, Math.floor((cappedNowMs - fundedAtMs) / 1000)));
  return elapsedSeconds / SECONDS_PER_DAY;
};

/** Per-day simple interest accrued so far (raw token units), capped at duration. */
export const computeAccruedInterest = (
  principalRaw: bigint,
  interestRateBps: bigint,
  fundedAtMs: number,
  durationSeconds: bigint,
  nowMs: number = Date.now(),
): bigint => {
  const days = cappedElapsedDays(fundedAtMs, durationSeconds, nowMs);
  return (principalRaw * interestRateBps * days) / (BPS_DENOMINATOR * DAYS_PER_YEAR);
};

/** Total amount owed right now = principal + accrued interest. */
export const computeTotalDue = (
  principalRaw: bigint,
  interestRateBps: bigint,
  fundedAtMs: number,
  durationSeconds: bigint,
  nowMs: number = Date.now(),
): bigint => principalRaw + computeAccruedInterest(principalRaw, interestRateBps, fundedAtMs, durationSeconds, nowMs);

/** Repayment progress as a 0–100 integer percentage. */
export const computeProgressPct = (amountRepaid: bigint, totalDue: bigint, repaid: boolean): number =>
  totalDue > 0n ? Number((amountRepaid * 100n) / totalDue) : repaid ? 100 : 0;

/** Remaining balance, floored at zero. */
export const computeRemaining = (totalDue: bigint, amountRepaid: bigint): bigint =>
  totalDue > amountRepaid ? totalDue - amountRepaid : 0n;

/** Human-readable "Due in Nd" / "Overdue by Nd" / "Due today" label. */
export const formatDueDateLabel = (dueDate: Date | null): string => {
  if (!dueDate) return 'No deadline';
  const diff = dueDate.getTime() - Date.now();
  if (diff < 0) return `Overdue by ${Math.ceil(Math.abs(diff) / 86400000)}d`;
  const days = Math.ceil(diff / 86400000);
  if (days === 0) return 'Due today';
  return `Due in ${days}d`;
};
```

NOTE: This CHANGES the signatures of `computeTotalDue` (was `(principalRaw, interestRateRaw)`) and REMOVES `PERCENT_WAD` and `interestRateToBps`. You MUST update every caller (Task 10 covers `LoanRepayRow.svelte`; also grep for other importers). Run:
`grep -rn "computeTotalDue\|interestRateToBps\|PERCENT_WAD\|from '\\$lib/loans/loanMath'" apps/web/src`
and fix each caller in this task or note them for Task 10/11. Prefer to keep `getRepaymentDetails` (the on-chain read) as the authoritative source for `totalDue`/`remaining` in components that already call it; use `loanMath` for display estimates where the component only has DB data.

- [ ] **Step 2: Type-check**

Run: `cd apps/web && pnpm check 2>&1 | grep -i loanmath`
Expected: no errors originating in `loanMath.ts`. Caller breakages are addressed in Tasks 10-11.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/loans/loanMath.ts
git commit -m "feat(web): annual-bps interest model with per-day capped accrual in loanMath"
```

---

## Task 10: Web borrow form — APR, duration, and fund-window inputs

**Files:**
- Modify: `apps/web/src/lib/components/ui/CreateLoan.svelte`

- [ ] **Step 1: Add form state for the three new inputs**

In the `<script>` block of `CreateLoan.svelte`, add state (Svelte 5 runes, matching existing `$state` usage):
```typescript
  // Interest (annual %) and timing. Presets in days; "custom" reveals a number input.
  let interestRatePct = $state('5'); // annual percentage, user-facing
  let durationDays = $state('30');
  let durationCustom = $state(false);
  let fundWindowDays = $state('7');
  let fundWindowCustom = $state(false);
```

- [ ] **Step 2: Add validation + conversion in `handleCreateLoan`**

Before calling `createLoan`, validate and convert. Insert after the existing borrow-amount validation, before the `status = 'Waiting...'` line:
```typescript
    const ratePct = Number(interestRatePct);
    if (!isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
      status = 'Enter a valid interest rate between 0 and 100% APR.';
      return;
    }
    const durDays = Number(durationDays);
    if (!Number.isInteger(durDays) || durDays <= 0) {
      status = 'Loan duration must be a positive whole number of days.';
      return;
    }
    const windowDays = Number(fundWindowDays);
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
      status = 'Funding window must be a positive whole number of days.';
      return;
    }
    const interestRateBps = Math.round(ratePct * 100); // 5% -> 500 bps
    const durationSeconds = durDays * 86400;
    const fundWindowSeconds = windowDays * 86400;
```
Then update the call:
```typescript
      await createLoan(
        collateralAmount,
        collateralToken,
        borrowToken,
        borrowAmount,
        interestRateBps,
        durationSeconds,
        fundWindowSeconds,
      );
```

- [ ] **Step 3: Add the input UI**

Add markup inside the `<form>`, after the borrow-amount `<label>` block and before the LTV indicator. Use the existing label/input styling in the file (copy the class strings from the collateral input). Provide preset `<select>`s for duration and fund window with a "Custom" option that reveals a number input, plus an APR number input:

```svelte
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Interest Rate (APR %):</span>
    <input
      class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
      inputmode="decimal"
      placeholder="5"
      type="text"
      bind:value={interestRatePct}
    />
  </label>

  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Loan Duration:</span>
    <select
      class="border border-gray-300 rounded-lg px-4 py-2 bg-gray-50"
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        durationCustom = v === 'custom';
        if (!durationCustom) durationDays = v;
      }}
    >
      <option value="7">7 days</option>
      <option value="14">14 days</option>
      <option value="30" selected>30 days</option>
      <option value="60">60 days</option>
      <option value="90">90 days</option>
      <option value="custom">Custom…</option>
    </select>
    {#if durationCustom}
      <input
        class="border border-gray-300 rounded-lg px-4 py-2 bg-gray-50"
        inputmode="numeric"
        placeholder="Days"
        type="text"
        bind:value={durationDays}
      />
    {/if}
  </label>

  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Fund Within:</span>
    <select
      class="border border-gray-300 rounded-lg px-4 py-2 bg-gray-50"
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        fundWindowCustom = v === 'custom';
        if (!fundWindowCustom) fundWindowDays = v;
      }}
    >
      <option value="1">1 day</option>
      <option value="3">3 days</option>
      <option value="7" selected>7 days</option>
      <option value="14">14 days</option>
      <option value="custom">Custom…</option>
    </select>
    {#if fundWindowCustom}
      <input
        class="border border-gray-300 rounded-lg px-4 py-2 bg-gray-50"
        inputmode="numeric"
        placeholder="Days"
        type="text"
        bind:value={fundWindowDays}
      />
    {/if}
  </label>
```

- [ ] **Step 4: Type-check + manual UI verification**

Run: `cd apps/web && pnpm check`
Expected: no type errors in `CreateLoan.svelte` or `vouchVault.ts`.

Manual (golden path): with the dev stack running (`pnpm dev` from repo root, or at least `apps/web`), open `http://localhost:5173/borrow`, fill the form, select a duration preset, switch to Custom and enter a value, and submit (wallet confirmation). Confirm: invalid APR (>100) and zero/blank duration/window show the validation messages; valid input reaches "Waiting for wallet confirmation...". If you cannot run a wallet in this environment, state that explicitly and verify the validation branches via the form without submitting.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/ui/CreateLoan.svelte
git commit -m "feat(web): collect APR, loan duration, and fund window on the borrow form"
```

---

## Task 11: Marketplace — filter expired-unfunded loans + display + cancel

**Files:**
- Modify: `apps/web/src/routes/marketplace/+page.ts`
- Modify: `apps/web/src/routes/marketplace/+page.svelte`

- [ ] **Step 1: Filter the load query**

In `apps/web/src/routes/marketplace/+page.ts`, the query is `.eq('status', 'pending').order('createdAt', { ascending: false })`. Add a fund-deadline filter so expired-unfunded loans are excluded:
```typescript
    .eq('status', 'pending')
    .gt('fundDeadline', new Date().toISOString())
    .order('createdAt', { ascending: false })
```

- [ ] **Step 2: Apply the same filter to the client-side `fetchLoans`**

In `apps/web/src/routes/marketplace/+page.svelte`, the `fetchLoans()` function has the identical `.eq('status','pending').order(...)`. Add the same `.gt('fundDeadline', new Date().toISOString())` filter so the realtime refresh stays consistent.

- [ ] **Step 3: Fix the interest display to annual bps**

The marketplace currently renders `{formatUint256(loan.interestRate)}%` (treats the stored value as a plain percent). Since `interestRate` is now annual basis points, render it as `{(Number(loan.interestRate) / 100).toFixed(2)}% APR`. Locate the interest cell (around the loan row render) and update it. If `formatUint256` is used elsewhere for amounts, leave those; only change the interest-rate cell.

- [ ] **Step 4: Add a Cancel button in the "Your loan" slot**

Where the marketplace shows `isOwnLoan` → "Your loan" (the borrower viewing their own pending loan), add a Cancel button that calls the wallet wrapper. Import `cancelLoan` from `$lib/wallet/vouchVault`. On click, call `await cancelLoan(BigInt(loan.onChainLoanId))`, set a local status, and on success let the realtime subscription refresh the list (the `LoanCancelled` event → DB status `cancelled` → row leaves the `pending` query). Mirror the existing "Fund" button's handler structure (loading state, try/catch, error surface). Example:
```svelte
{#if isOwnLoan}
  <button
    class="<copy the existing button classes>"
    disabled={cancelling}
    onclick={async () => {
      cancelling = true;
      try {
        await cancelLoan(BigInt(loan.onChainLoanId));
      } catch (e) {
        // surface error like the Fund button does
      } finally {
        cancelling = false;
      }
    }}
  >
    {cancelling ? 'Cancelling…' : 'Cancel request'}
  </button>
{/if}
```
Add a `let cancelling = $state(false);` (scoped per-row if the list maps rows — follow the existing pattern for how the Fund button tracks per-row loading; if Fund uses a single page-level flag, match that).

- [ ] **Step 5: Type-check + manual verification**

Run: `cd apps/web && pnpm check`
Expected: no type errors.

Manual: confirm an expired-unfunded loan (set a row's `fundDeadline` to the past via Supabase Studio at `http://localhost:54323`) disappears from `/marketplace`; confirm a borrower viewing their own pending loan sees "Cancel request"; confirm the interest shows `X.XX% APR`. If wallet interaction isn't possible here, verify the query filter and display, and state the cancel-click was not exercised end-to-end.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/marketplace/+page.ts apps/web/src/routes/marketplace/+page.svelte
git commit -m "feat(web): hide expired-unfunded loans, show APR, add cancel on marketplace"
```

---

## Task 12: Dashboard loan row — APR/due display + Cancel for pending loans

**Files:**
- Modify: `apps/web/src/lib/components/ui/LoanRepayRow.svelte`

**Context:** This row imports from `loanMath` (now changed: `computeTotalDue` signature changed; `interestRateToBps` removed) and from `vouchVault` (`getRepaymentDetails`, now 7-tuple). It already derives `dueDate` from `loan.dueAt` and shows interest. It must (a) compile against the new loanMath/RepaymentDetails, (b) show a Cancel button when the loan is pending.

- [ ] **Step 1: Update loanMath usage**

Open `apps/web/src/lib/components/ui/LoanRepayRow.svelte`. Find imports from `$lib/loans/loanMath`. Remove `interestRateToBps` from the import. For the interest display, the row already prefers `chainDetails.interestRateBps` (from `getRepaymentDetails`) — keep that as the source of truth. For the fallback that used `interestRateToBps(interestRateRaw)`, replace with the DB value which is now already bps: `Number(loan.interestRate)`. So `displayInterestRateBps` becomes:
```typescript
  const displayInterestRateBps = $derived(
    chainDetails?.interestRateBps ?? Number(loan.interestRate ?? 0),
  );
```
If the row calls `computeTotalDue(principalRaw, interestRateRaw)` with the OLD 2-arg signature, switch the displayed total to the authoritative on-chain `chainDetails.totalDue` (from `getRepaymentDetails`) when available; only use `computeTotalDue` with the new full signature (principal, bps, fundedAtMs, durationSeconds) if `chainDetails` is absent. Read the component to see exactly how `totalDue`/remaining are currently derived and adapt minimally — prefer `chainDetails` values.

- [ ] **Step 2: Add a Cancel button for pending loans**

The action `Table.Cell` currently shows a Repay button only when `isActive`. Add a branch: when `isPending` (the row already computes an `isPending` flag for the status badge), show a "Cancel request" button. Import `cancelLoan` from `$lib/wallet/vouchVault`. Wire it like the Repay button (loading state, try/catch, and call the existing `onRepaid`-style refresh callback if one exists, or rely on the parent's realtime refresh):
```svelte
{#if isPending}
  <button
    class="<copy Repay button classes>"
    disabled={cancelling}
    onclick={async () => {
      cancelling = true;
      try {
        await cancelLoan(BigInt(loan.onChainLoanId));
        onRepaid?.(); // reuse the row's refresh hook if present
      } catch (e) {
        // surface like the repay flow
      } finally {
        cancelling = false;
      }
    }}
  >
    {cancelling ? 'Cancelling…' : 'Cancel request'}
  </button>
{/if}
```
Add `let cancelling = $state(false);` in the script. Confirm the actual refresh callback prop name by reading the component (the explore noted an `onRepaid` prop).

- [ ] **Step 3: Type-check**

Run: `cd apps/web && pnpm check`
Expected: no type errors anywhere in the web app (this is the task that resolves the loanMath signature change for this consumer; if other consumers remain broken, fix them here too — grep `interestRateToBps`/`PERCENT_WAD` again to be sure none remain).

- [ ] **Step 4: Manual verification**

Manual: on `/dashboard` with a pending loan owned by the connected wallet, confirm a "Cancel request" button appears on that row and not on active loans; confirm interest shows as `X.XX%` and due date label renders. If wallet isn't available, verify compilation + that the button renders for a pending row (e.g., via a seeded pending loan) without exercising the on-chain call; state this explicitly.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/ui/LoanRepayRow.svelte
git commit -m "feat(web): show APR/due date and a cancel action on pending dashboard loans"
```

---

## Task 13: Full verification across the stack

**Files:** none (verification only)

- [ ] **Step 1: API tests**

Run: `cd apps/api && pnpm test`
Expected: all green.

- [ ] **Step 2: Web type-check + build**

Run: `cd apps/web && pnpm check && pnpm build`
Expected: no type errors; build succeeds.

- [ ] **Step 3: DB migrations apply cleanly from scratch**

Run: `cd "/Users/nirarad/Computer Science/vouch" && npx supabase db reset`
Expected: every migration applies with no error.

- [ ] **Step 4: Contract tests still green (sanity)**

Run: `cd packages/contracts && npx hardhat test`
Expected: 61 passing (unchanged by this plan).

- [ ] **Step 5: End-to-end smoke (if a wallet + full dev stack are available)**

With `pnpm dev` (Redis + Supabase + web + API) and a local Hardhat node + deployed contract:
1. Create a loan on `/borrow` with APR 5%, 30-day duration, 7-day fund window. Confirm the loans row in Supabase Studio has `interestRate=500`, a 30-day `duration`, and a `fundDeadline` ~7 days out.
2. Confirm it appears on `/marketplace`. Fund it from a second wallet; confirm `status=active`, `fundedAt` set, `dueAt` ≈ fundedAt + 30 days.
3. Create another loan, let its fund window pass (or set `fundDeadline` to the past in Studio), confirm it is NOT shown on `/marketplace`. Cancel it from the dashboard/marketplace; confirm `status=cancelled`, `cancelledAt` set, collateral returned on-chain.
If a wallet/dev stack is unavailable in this environment, state that explicitly and rely on Steps 1-4 plus the per-task unit tests.

- [ ] **Step 6: No commit** (verification only). If any step fails, fix in the owning task's files and re-run.

---

## Self-Review (completed during planning)

- **Spec coverage:** APR stored + displayed (Tasks 2, 5, 6, 9, 11, 12) ✓; loan duration stored, drives `dueAt` at funding (Tasks 2, 3) ✓; fund window stored as `fundDeadline` (Tasks 1, 2, 5, 6) ✓; expired-unfunded hidden from marketplace (Task 11) ✓; borrower cancel anytime before funding, both UI locations (Tasks 4, 7, 8, 11, 12) ✓; partial-payment semantics already on-chain (Plan 1) — off-chain recording unchanged and still correct ✓; `getRepaymentDetails` 7-tuple consumed (Task 8) ✓; `createLoan` arity fixed (Task 8) ✓; rate-unit inconsistency resolved to annual bps (Tasks 9, 11, 12) ✓.
- **Decisions honored:** annual-bps DB storage (no WAD conversion in listener); cancel in BOTH dashboard and marketplace.
- **Ordering/dependencies:** DB first (1-4) → types+API (5-7) → web (8-12) → verification (13). Web Task 9 changes a shared `loanMath` signature; Tasks 10-12 update all consumers; Task 13 Step 2 guarantees no consumer left broken.
- **Type/name consistency:** `interestRateBps`/`durationSeconds`/`fundWindowSeconds` used consistently from form → wallet → contract; `p_interest_rate_bps`/`p_duration_seconds`/`p_fund_deadline` consistent DB↔service; `cancel`/`cancel_loan_with_transaction`/`CancelLoanDto`/`handleLoanCancelled`/`cancelLoan` consistent across layers.
- **Known soft spots flagged inline for the implementer:** exact transactions-table columns/type for the cancel RPC (Task 4 Step 2 — must match repay/partial); how `getRepaymentDetails` returns `uint16` in the listener mock (Task 6); per-row vs page-level cancel loading flag (Tasks 11-12 — match the existing Fund/Repay pattern).
