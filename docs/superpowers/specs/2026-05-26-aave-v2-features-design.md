# Aave V2 Feature Set Design

## Goal

Add two new Aave-derived features to the cold-start ML training pipeline:
`aaveDaysSinceLastBorrow`, `aaveRepayRatio`.
Both come from the Aave V3 subgraph using the existing pagination infrastructure.
No version bump — the existing migration and `cold_start_v1` are edited in place since
this PR hasn't merged to main yet.

`aaveAvgHealthFactorAtBorrow` was originally planned but dropped: the Aave V3 subgraph's
`Borrow` type does not expose a `healthFactor` field (it's a live account state, not stored
per event). The DB column was removed.

## Architecture

Data flows through the same pipeline as today:

```
extract_aave.py  →  types.py  →  transform.py  →  load.py  →  train_xgboost.py
                                                              check_wallet.py
```

New data enters at `extract_aave.py` and flows through every layer to the model.
`check_wallet.py` needs a parallel update so single-wallet scoring stays consistent
with the trained model's feature vector.

## Feature Definitions

| Feature | Type | Source | Both classes? |
|---------|------|--------|---------------|
| `aaveDaysSinceLastBorrow` | `int` | `(snapshot_at - last_borrow_at).days` | Yes — risky uses `last_liquidation_at` as proxy |
| `aaveRepayRatio` | `float` | `repays_count / borrows_count`, capped at 1.0 | Both — new `repays` subgraph query, same pagination pattern |

## File Changes

### `supabase/migrations/20260520000000_training_dataset.sql`

Edit in place (PR not yet merged). Add 3 nullable columns to the `CREATE TABLE` statement:

```sql
"aaveDaysSinceLastBorrow"       integer,
"aaveAvgHealthFactorAtBorrow"   numeric(30, 10),
"aaveRepayRatio"                numeric(10, 6),
```

### `services/ml-training/src/vouch_ml_training/data/extract_aave.py`

**`_BORROWS_QUERY`** — add `healthFactor` to fetched fields.

**`_REPAYS_QUERY`** — new query, same structure as `_BORROWS_QUERY`:
```graphql
query Repays($first: Int!, $cursor: Int!) {
  repays(
    first: $first
    where: { timestamp_lte: $cursor }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    timestamp
    user { id }
  }
}
```

**`fetch_safe_borrowers`** — after the borrows pass, run a second paginated pass over
`repays` for the same address set. Count repays per wallet. Compute:
- `aave_avg_health_factor_at_borrow`: mean of health factor values from borrow events
  (already paged), divided by 1e27 to convert from ray units to a human-readable ratio.
- `aave_repay_ratio`: `repays_count / borrows_count`, capped at 1.0. `0.0` if no borrows.

**`fetch_liquidated_wallets`** — after the liquidations pass we have a known set of
addresses. Use the same batched alias pattern as `_fetch_first_borrow_timestamps` to
fetch per-wallet repay counts AND borrow counts in parallel (e.g. `_fetch_repay_counts`).
Do NOT use the global pagination pass here — paging through all repays globally to find
~2000 specific addresses is wasteful. Compute `aave_repay_ratio = repay_count / borrow_count`,
capped at 1.0, `None` if borrow_count is 0. `aave_days_since_last_borrow` derived from
`last_liquidation_at` in transform.

### `services/ml-training/src/vouch_ml_training/data/types.py`

**`SafeBorrower`** — add:
```python
aave_avg_health_factor_at_borrow: float | None = None
aave_repay_ratio: float | None = None
```
(`aave_days_since_last_borrow` is derived in transform from the existing `last_borrow_at`.)

**`LiquidationAggregate`** — add:
```python
aave_repay_ratio: float | None = None
```
(Health factor stays `None` for risky class — not fetched. Days since last borrow derived
from `last_liquidation_at` in transform.)

**`TrainingRow`** — add:
```python
aave_days_since_last_borrow: int | None = None
aave_avg_health_factor_at_borrow: float | None = None
aave_repay_ratio: float | None = None
```

### `services/ml-training/src/vouch_ml_training/data/transform.py`

In `build_training_rows`, populate the 3 new `TrainingRow` fields:

- **Risky class:** `aave_days_since_last_borrow = (snap - liq.last_liquidation_at).days`,
  `aave_repay_ratio = liq.aave_repay_ratio`, `aave_avg_health_factor_at_borrow = None`
- **Safe class:** `aave_days_since_last_borrow = (snap - safe.last_borrow_at).days` (or
  `None` if `last_borrow_at` is `None`), pass through `safe.aave_avg_health_factor_at_borrow`
  and `safe.aave_repay_ratio`

### `services/ml-training/src/vouch_ml_training/data/load.py`

Add 3 new mappings to `_row_to_db`:
```python
"aaveDaysSinceLastBorrow": row.aave_days_since_last_borrow,
"aaveAvgHealthFactorAtBorrow": row.aave_avg_health_factor_at_borrow,
"aaveRepayRatio": row.aave_repay_ratio,
```

### `services/ml-training/src/vouch_ml_training/pipelines/train_xgboost.py`

Add 3 entries to `FEATURE_COLUMNS`:
```python
"aaveDaysSinceLastBorrow",
"aaveAvgHealthFactorAtBorrow",
"aaveRepayRatio",
```

### `services/ml-training/scripts/check_wallet.py`

**`_USER_BORROWS_QUERY`** — add `healthFactor` to fetched fields.

**`_USER_REPAYS_QUERY`** — new query fetching repay count for the wallet (skip-based,
same guard against the 5000 skip cap).

**`_fetch_user_aave_stats`** — extend to also return:
- `avg_health_factor`: mean of health factor values ÷ 1e27
- `repay_ratio`: repay count / borrow count, capped at 1.0

**`_build_features`** — add the 3 new keys to the features dict in the same order as
`FEATURE_COLUMNS`.

### `services/ml-training/README.md`

- Add a **Tools** section documenting `scripts/check_wallet.py` usage.
- Update the Output section feature list to include the 3 new columns.
- Remove `aaveAvgHealthFactorAtBorrow` and `aaveTimeSinceLastBorrowDays` from "What's next".

## Testing

- Update `tests/test_transform.py`: the existing label-assignment test passes `aave_repay_ratio`
  on both input types; assert the new fields are present on the output rows.
- New test `test_extract_aave_aggregations`: unit test the repay ratio computation and health
  factor averaging logic with synthetic event data (no network calls).

## What's next (out of scope for this spec)

**Medium effort — RPC calls, no new subgraph queries:**
- `nftHoldings` — NFT count via `eth_call` to common ERC-721 contracts or an NFT indexer. Proxy for wealth/sophistication.
- `defiProtocolCount` — deeper than `uniqueProtocolsInteracted` (which counts unique contract addresses). Could count interactions with known protocol registries.

**Requires Vouch protocol history (future):**
- `vouchLoanRepaymentHistory` — direct repayment outcomes from the `loans` table. This is the highest-signal feature possible and is what will make the model genuinely useful beyond cold-start. Not available until the protocol has real loan history.

**Sequence models (longer-term):**
- Raw transaction sequences fed into an LSTM or Transformer. High complexity for uncertain gain at this stage — only worth pursuing once there are enough labeled Vouch loan outcomes to justify the architecture change.

## Data flow summary

```
extract_aave.py
  fetch_liquidated_wallets → LiquidationAggregate(aave_repay_ratio)
    [batched per-wallet alias queries for repay_count + borrow_count]
  fetch_safe_borrowers     → SafeBorrower(aave_avg_health_factor_at_borrow, aave_repay_ratio)
    [global repays pagination pass, same pattern as borrows]

transform.py
  build_training_rows      → TrainingRow(aave_days_since_last_borrow,
                                         aave_avg_health_factor_at_borrow,
                                         aave_repay_ratio)

load.py → training_dataset (3 new columns)

train_xgboost.py → FEATURE_COLUMNS += 3 new features

check_wallet.py → fetches same 3 features for single-wallet scoring
```
