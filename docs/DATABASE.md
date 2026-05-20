# Vouch Database Schema

The Vouch platform stores all off-chain data in a PostgreSQL database
managed by [Supabase](https://supabase.com/). The database is the persistent
backing store for:

- Reference data for supported chains and tokens
- Loan lifecycle (mirroring on-chain `VouchVault` state)
- Transaction history derived from chain events
- Credit-scoring outputs + ML feature snapshots
- In-app notifications

All migrations live under `supabase/migrations/` and are applied with the
Supabase CLI (`npx supabase db reset` for a clean local rebuild).

---

## High-level ER diagram

```
        ┌─────────┐         ┌─────────┐
        │ chains  │◄────────│ tokens  │
        └────┬────┘         └────┬────┘
             │                   │
             ▼                   ▼
        ┌────────────┐    ┌──────────────┐
        │   loans    │───►│ transactions │
        └─────┬──────┘    └──────────────┘
              │
              ▼
        ┌──────────────────┐
        │ notifications    │
        └──────────────────┘

   ┌──────────────────┐    ┌────────────────────────┐
   │ credit_scores    │    │ ml_feature_snapshots   │
   └──────────────────┘    └────────────────────────┘
```

Identity is keyed by **wallet address** everywhere (no separate user UUID),
so the on-chain world and off-chain world line up cleanly. Addresses use
the custom `address` domain (lowercase, 0x-prefixed, 42 chars).

---

## Entities

### `chains` + `tokens`

Reference tables registering every supported network and every ERC-20 /
native asset on that network. Tokens are scoped per chain (same symbol can
exist on multiple networks).

### `loans`

Mirrors on-chain `VouchVault` loans. A row is created the moment the
borrower locks collateral (status `pending`). Transitions through `active`
→ (`repaid` | `defaulted` | `liquidated`) or `cancelled`. Carries both the
collateral and requested-principal token references, the off-chain
`purpose` / `description` provided by the borrower, a free-form `metadata`
JSONB bag, and lifecycle timestamps (`fundedAt`, `dueAt`, `repaidAt`,
`liquidatedAt`, `cancelledAt`).

### `transactions`

Append-only log of every chain event affecting a loan's lifecycle. The
unique `(chainId, txHash, logIndex)` index makes the ingestion pipeline
idempotent — replaying the same event is a no-op.

### `credit_scores`

Append-only snapshots written by the ML engine, with `score` (0..1000),
`confidence` (0..1), `factors` (JSONB), `explanation`, and `modelVersion`
for reproducibility. View `credit_scores_latest` (declared with
`security_invoker = true`) exposes the most-recent row per address for
hot reads.

### `ml_feature_snapshots`

Raw feature vectors fed into a scoring run, keyed by `address` +
`featureSet` (e.g. `borrower_v1`), with an optional `sourceHash` for cache
busting. Consumed by `services/ml-training` for offline retraining.

### `notifications`

Per-recipient inbox keyed by `recipientAddress`, with a typed enum
(`loan_funded`, `loan_repaid`, `loan_liquidated`, `loan_due_soon`,
`credit_score_updated`, `system`), optional `loanId` FK, and a `payload`
JSONB bag. The web client subscribes via Supabase Realtime to deliver
toasts and update the bell badge in real time.

---

## RPC functions

All RPCs are `SECURITY DEFINER`, run with an empty `search_path`, and are
restricted to `service_role`:

| Function                            | Called by                                    | Purpose                                                                                                                |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create_loan_with_transaction(...)` | `BlockchainListenerService` on `LoanCreated` | Atomically creates the `loans` row + the collateral-deposit `transactions` row.                                        |
| `fund_loan_with_transaction(...)`   | `BlockchainListenerService` on `LoanFunded`  | Marks the loan `active`, writes the disbursement transaction, and pushes a `loan_funded` notification to the borrower. |

---

## Authentication

The NestJS API authenticates wallets via signed nonces (EIP-191
`personal_sign`) and issues a JWT signed with the shared `JWT_SECRET`. The
JWT carries an `address` claim used by RLS via
`public.current_wallet_address()`.

Because the API and Supabase share `JWT_SECRET`, the web client can talk to
Supabase directly with the API-issued JWT and RLS will enforce per-wallet
access on tables like `notifications` and `ml_feature_snapshots`.

---

## Row-Level Security

| Table                                                        | anon / authenticated                           | service_role |
| ------------------------------------------------------------ | ---------------------------------------------- | ------------ |
| `chains`, `tokens`, `loans`, `transactions`, `credit_scores` | SELECT (public read)                           | full         |
| `notifications`                                              | SELECT own row; UPDATE own row (`readAt` only) | full         |
| `ml_feature_snapshots`                                       | SELECT own row                                 | full         |

The API uses `SUPABASE_SECRET_KEY` (service role) and bypasses RLS for all
writes; the web client uses `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (anon role)
and is fully constrained by the policies above. For `notifications`, the
broad `INSERT/UPDATE/DELETE` grants to `anon`/`authenticated` are revoked
and only `UPDATE("readAt")` is re-granted to `authenticated`.

---

## Realtime

The Supabase Realtime publication includes: `loans`, `transactions`,
`notifications`, `credit_scores`. Add new tables to
`20260518000011_realtime.sql` when introducing new live-updating UI
surfaces.

---

## Data ingestion pipeline

```
on-chain VouchVault event
        │
        ▼
BlockchainListenerService (apps/api/src/blockchain-listener)
        │  dispatch by eventName:
        │     LoanCreated → create_loan_with_transaction()
        │     LoanFunded  → fund_loan_with_transaction()
        │     …
        │  (per-event idempotency is enforced by the unique
        │   (chainId, txHash, logIndex) index on transactions.)
        ▼
PostgreSQL (loans / transactions / notifications)
        │
        ▼
Supabase Realtime → SvelteKit web client
```

---

## AI / credit-engine integration

```
apps/ml-engine (FastAPI)            services/ml-training (batch)
        │                                     │
        │ reads loans, transactions           │ reads ml_feature_snapshots
        │ writes credit_scores                │ writes new modelVersion artifacts
        ▼                                     ▼
   credit_scores  ◄──────  ml_feature_snapshots
```

When the API receives `GET /scoring/:address`:

1. It proxies the request to `apps/ml-engine`.
2. The engine computes (or reuses a cached) feature vector and persists it
   to `ml_feature_snapshots`.
3. The engine inserts the resulting score into `credit_scores`.
4. The API returns the response from `apps/ml-engine`; it does not currently
   read back from `credit_scores_latest` on the request path.

This persistence loop makes every scoring decision reproducible, supports
offline retraining, and powers downstream analytics dashboards. Persisted
scores can still be queried later for analytics or other database-backed
read paths.

---

## Operational notes

- Regenerate the TypeScript types after any schema change:
  ```bash
  pnpm db:generate:types
  ```
- Reset the local DB (drops everything and replays migrations + seed):
  ```bash
  npx supabase db reset
  ```
- New migrations should be additive once the platform is deployed. Use the
  `IF NOT EXISTS` / `CREATE OR REPLACE` idiom for repeatability during
  development.
