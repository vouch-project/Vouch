# Vouch Database Schema

The Vouch platform stores all off-chain data in a PostgreSQL database
managed by [Supabase](https://supabase.com/). The database is the persistent
backing store for:

- User profiles & authentication state
- Loan lifecycle (mirroring on-chain `VouchVault` state)
- Transaction history derived from chain events
- Social vouching graph
- Credit-scoring outputs + ML feature snapshots
- In-app notifications & analytics
- A deduplication log for the blockchain ingestion pipeline

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
   ┌──────────┐  ┌────────────┐    ┌──────────────┐
   │  users   │  │   loans    │───►│ transactions │
   └──────────┘  └─────┬──────┘    └──────────────┘
        ▲              │
        │              ▼
   ┌──────────┐  ┌──────────────────┐
   │ vouches  │  │ notifications    │
   └──────────┘  └──────────────────┘
        ▲
        │
   ┌──────────────────┐    ┌────────────────────────┐
   │ credit_scores    │◄───│ ml_feature_snapshots   │
   └──────────────────┘    └────────────────────────┘

   ┌──────────────────────┐    ┌────────────────────┐
   │ blockchain_event_log │    │ analytics_events   │
   └──────────────────────┘    └────────────────────┘
```

Identity is keyed by **wallet address** everywhere (not user UUID), so the
on-chain world and off-chain world line up cleanly. The `users` table simply
hangs profile metadata off the address.

---

## Entities

### `users`

Off-chain profile, one row per wallet. Created lazily on first login by the
`ensure_user(address)` RPC. Stores:

- Identity: `address`, optional `handle`, `displayName`, `bio`, `avatarUrl`,
  optional verified `email`.
- KYC: `kycStatus`, `kycProvider`, `kycReference`.
- Denormalized counters (`totalLoansBorrowed`, `totalVouchesReceived`, …)
  kept fresh by triggers / background jobs for fast dashboard rendering.
- Free-form `preferences` + `metadata` JSONB bags.

### `chains` + `tokens`

Reference tables registering every supported network and every ERC-20 /
native asset on that network. Tokens are scoped per chain (same symbol can
exist on multiple networks).

### `loans`

Mirrors on-chain `VouchVault` loans. A row is created the moment the
borrower locks collateral (status `pending`). Transitions through `active`
→ (`repaid` | `defaulted` | `liquidated`) or `cancelled`. Carries both the
collateral and requested-principal token references, the off-chain
`purpose` / `description` provided by the borrower, and lifecycle
timestamps (`fundedAt`, `dueAt`, `repaidAt`, `liquidatedAt`).

### `transactions`

Append-only log of every chain event affecting a loan's lifecycle. The
unique `(chainId, txHash, logIndex)` index makes the ingestion pipeline
idempotent — replaying the same event is a no-op.

### `vouches`

Directed social endorsements `voucher -> vouchee`, optionally with an
on-chain stake. At most one **active** vouch may exist per pair; revoked
ones are kept for auditability. Feeds the credit-scoring graph.

### `credit_scores`

Append-only snapshots written by the ML engine, with `score` (0..1000),
`confidence` (0..1), `factors` (JSONB), and `modelVersion` for
reproducibility. View `credit_scores_latest` exposes the most-recent row
per address for hot reads.

### `ml_feature_snapshots`

Raw feature vectors fed into a scoring run, keyed by `address` +
`featureSet` (e.g. `borrower_v1`). Consumed by `services/ml-training` for
offline retraining.

### `notifications`

Per-recipient inbox. The web client subscribes via Supabase Realtime to
deliver toasts and update the bell badge in real time.

### `blockchain_event_log`

Idempotency / replay log for the chain ingestion pipeline
(`apps/api/src/blockchain-listener`). The table/function pair is the
intended deduplication mechanism for blockchain events, but the current
`BlockchainListenerService` implementation does not invoke
`record_blockchain_event(...)` before writing loan/transaction state.
Do not rely on this table alone for deduplication/replay guarantees until
the listener is explicitly wired to that RPC.

### `analytics_events`

Generic event sink for product analytics, fed by both the web client and
the API.

---

## RPC functions

All RPCs are `SECURITY DEFINER`, run with an empty `search_path`, and are
restricted to `service_role`:

| Function                            | Called by                                    | Purpose                                                                                                                |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ensure_user(address)`              | `AuthService.login`                          | Upserts the user row, stamps `lastLoginAt`.                                                                            |
| `create_loan_with_transaction(...)` | `BlockchainListenerService` on `LoanCreated` | Atomically creates the `loans` row + the collateral-deposit `transactions` row.                                        |
| `fund_loan_with_transaction(...)`   | `BlockchainListenerService` on `LoanFunded`  | Marks the loan `active`, writes the disbursement transaction, and pushes a `loan_funded` notification to the borrower. |
| `record_blockchain_event(...)`      | `BlockchainListenerService` ingress          | Dedup log; returns `true` only if the event is new.                                                                    |

---

## Authentication

The NestJS API authenticates wallets via signed nonces (EIP-191
`personal_sign`) and issues a JWT signed with the shared `JWT_SECRET`. The
JWT carries an `address` claim used by RLS via
`public.current_wallet_address()`.

Because the API and Supabase share `JWT_SECRET`, the web client can talk to
Supabase directly with the API-issued JWT and RLS will enforce
per-wallet access on tables like `notifications` and `users`.

---

## Row-Level Security

| Table                                                                   | anon / authenticated                                      | service_role |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | ------------ |
| `chains`, `tokens`, `loans`, `transactions`, `vouches`, `credit_scores` | SELECT                                                    | full         |
| `users`                                                                 | SELECT own row; UPDATE own row (whitelisted columns only) | full         |
| `notifications`                                                         | SELECT own row; UPDATE own row (`readAt` only)            | full         |
| `ml_feature_snapshots`                                                  | SELECT own row                                            | full         |
| `blockchain_event_log`, `analytics_events`                              | deny-all (restrictive policy)                             | full         |

The API uses `SUPABASE_SECRET_KEY` (service role) and bypasses RLS for all
writes; the web client uses `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (anon role)
and is fully constrained by the policies above.

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
        │  1. record_blockchain_event() — dedup
        │  2. dispatch by eventName:
        │       LoanCreated → create_loan_with_transaction()
        │       LoanFunded  → fund_loan_with_transaction()
        │       …
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
        │ reads vouches, loans, transactions  │ reads ml_feature_snapshots
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
