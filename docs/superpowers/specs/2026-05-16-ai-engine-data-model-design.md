# AI Engine Data Model Design

**Issue:** [#12 — Define the Exact Data Model for the AI Engine](https://github.com/vouch-project/Vouch/issues/12)  
**Date:** 2026-05-16  
**Status:** Approved

## Overview

This document defines the data model, schema, and data flows required to power the Vouch Credit Scoring AI engine. It covers three new Supabase tables, the inference and training data flows, and the ml-engine API contract.

The deliverables for this issue are:
1. Three new Supabase migration files (tables defined, no ML logic)
2. Updated ml-engine API contract (GET endpoint with real response shape)
3. This spec

Downstream issues that depend on this:
- **#13** — ETL pipeline writes to `training_dataset`
- **#14** — Training script reads `training_dataset`, outputs `credit_model_v1.json`

---

## Schema

### Existing tables (owned by issue #11)

The `loans` and `transactions` tables capture raw loan lifecycle facts. The `user_credit_features` table defined below aggregates these into ML-consumable form.

> **Note on `walletAddress` as join key:** `credit_scores` and `user_credit_features` currently use `walletAddress` as their identifier. Once issue #11 merges and the `users` table exists, both tables should be migrated to use `userId uuid REFERENCES users(id)` as the FK instead. The `walletAddress` column can then be dropped or kept as a denormalized lookup.

---

### `training_dataset`

Populated by the issue #13 ETL script from Aave V3 subgraph and Etherscan data. Read by the issue #14 training script. Never touched by NestJS or the ml-engine at runtime.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `walletAddress` | address | |
| `walletAgeDays` | integer | Days since first tx on-chain |
| `totalTransactions` | integer | Total tx count across all protocols |
| `historicalLiquidationCount` | integer | Liquidations on Aave/Compound |
| `uniqueProtocolsUsed` | integer | Breadth of DeFi activity |
| `wasLiquidated` | boolean | **Target label** — true = risky |
| `dataSource` | text | e.g. `'aave_v3_subgraph'` |
| `createdAt` | timestamptz | |

---

### `credit_scores`

Cached inference results. Upserted by NestJS after calling the ml-engine. One row per wallet. NestJS checks `scoredAt` freshness before deciding whether to re-score (TTL: 24h).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `walletAddress` | address UNIQUE | TODO: migrate to `userId uuid REFERENCES users(id)` once #11 merges |
| `score` | integer | 0–1000 normalized |
| `confidence` | numeric(4,3) | 0.000–1.000 |
| `riskLevel` | enum | `very_low`, `low`, `medium`, `high`, `very_high` |
| `factors` | jsonb | Array of feature names that most influenced the score (explainability) |
| `modelVersion` | text | e.g. `'v1'` — ties score to the artifact that produced it |
| `scoredAt` | timestamptz | TTL anchor — re-score if older than 24h |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |

---

### `user_credit_features`

Aggregated Vouch-native behavioral data per wallet. Populated by NestJS after each loan lifecycle event (repayment, default). Empty until Vouch has live loan data. Used as additional input features for ml-engine v2 retraining and inference.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `walletAddress` | address UNIQUE | TODO: migrate to `userId uuid REFERENCES users(id)` once #11 merges |
| `totalLoansTaken` | integer | default 0 |
| `totalLoansRepaid` | integer | default 0 |
| `totalLoansDefaulted` | integer | default 0 |
| `onTimeRepaymentRate` | numeric(4,3) | 0.000–1.000, null until first repayment |
| `avgHealthFactorMaintained` | numeric(6,4) | null until first active loan |
| `lastUpdatedAt` | timestamptz | When NestJS last aggregated from loan events |
| `createdAt` | timestamptz | |

---

## Data Flows

### A. Cold-start training (offline — issues #13 & #14)

```
Etherscan / The Graph (Aave V3 subgraph)
  → ETL script (Python, issue #13) writes rows to training_dataset
  → Training script (Python, issue #14) reads training_dataset
  → Outputs credit_model_v1.json → saved to apps/ml-engine/models/
  → ml-engine FastAPI loads artifact at startup
```

This flow is entirely offline. NestJS is not involved.

---

### B. Live inference (triggered when user connects wallet)

```
Frontend → NestJS GET /users/score/:address
  → NestJS reads credit_scores: is scoredAt within 24h?
    → yes: return cached score immediately
    → no: call ml-engine GET /api/v1/score/:address
        → ml-engine fetches wallet features from Etherscan
        → ml-engine reads user_credit_features from Supabase (empty for now)
        → ml-engine runs inference using loaded credit_model_v1.json
        → returns { score, confidence, riskLevel, factors, modelVersion }
      → NestJS upserts result into credit_scores (sets scoredAt = now)
      → returns score to frontend
```

---

### C. Vouch-native feature update (future — after each loan event)

```
Loan repaid or defaulted on-chain
  → NestJS blockchain-listener detects event
  → NestJS upserts aggregated stats into user_credit_features
  → NestJS sets credit_scores.scoredAt = epoch for that wallet (forces re-score on next request)
```

This flow is a no-op until Vouch has live loans. The schema is ready to receive data when it does.

---

## ml-engine API Contract

### `GET /api/v1/score/{address}`

The existing stub endpoint is upgraded to a real inference endpoint.

**Path param:** `address` — EVM wallet address (e.g. `0x1234...`)

**Response (200):**
```json
{
  "address": "0x1234...",
  "score": 742,
  "confidence": 0.87,
  "riskLevel": "low",
  "factors": ["wallet_age_days", "total_transactions"],
  "modelVersion": "v1"
}
```

| Field | Description |
|---|---|
| `score` | Integer 0–1000. Higher = lower risk. |
| `confidence` | Model confidence in this prediction (0.0–1.0). |
| `riskLevel` | Human-readable bucket derived from score. |
| `factors` | Top features that influenced the score — stored in `credit_scores.factors` for explainability. |
| `modelVersion` | Matches the artifact filename (`credit_model_v1.json`). Allows NestJS to detect when a score was produced by an outdated model. |

**Response when model is not yet loaded (503):**
```json
{
  "detail": "Model not loaded — run training pipeline first."
}
```

---

## Architecture Alignment

This design follows Approach C from the architecture diagram (section 5 of the project spec):

- **ml-engine reads** feature data from Supabase directly (Etherscan + `user_credit_features`)
- **NestJS writes** inference results to `credit_scores`
- **Training scripts** read/write `training_dataset` directly — NestJS not involved

The ml-engine remains a stateless compute service from NestJS's perspective. NestJS owns all cache writes.
