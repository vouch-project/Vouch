# vouch-ml-training

ETL pipeline + XGBoost trainer for the **cold-start** Vouch credit scoring model.

The pipeline:

1. Pulls Aave V3 liquidation history from The Graph (positive class — "risky").
2. Pulls Aave V3 borrowers that have never been liquidated (negative class — "safe").
3. Enriches every wallet with Etherscan + RPC metadata (age, tx count, balance, contracts touched).
4. Upserts the result into the Supabase `training_dataset` table.
5. (Separate command) trains an XGBoost classifier on that table and writes a calibrated model artifact.

## Layout

```
services/ml-training/
├── pyproject.toml
├── .env.example
└── src/vouch_ml_training/
    ├── cli.py                       # `vouch-ml-training` entrypoint
    ├── config.py                    # pydantic-settings, env-driven
    ├── data/
    │   ├── extract_aave.py          # The Graph queries (liquidations + borrows)
    │   ├── extract_wallets.py       # Etherscan + RPC enrichment
    │   ├── transform.py             # subgraph + enrichment -> TrainingRow
    │   ├── load.py                  # Supabase upsert
    │   └── types.py
    ├── pipelines/
    │   ├── build_dataset.py         # ETL orchestrator
    │   └── train_xgboost.py         # trainer
    └── models/artifacts/            # versioned trained models (gitignored)
```

## Prerequisites

| Key | What | Where |
| --- | --- | --- |
| `THE_GRAPH_API_KEY` | Decentralized network gateway key | https://thegraph.com/studio/apikeys/ |
| `AAVE_V3_SUBGRAPH_ID` | Aave V3 mainnet (or Sepolia) subgraph id | https://thegraph.com/explorer/ |
| `ETHERSCAN_API_KEY` | Etherscan v2 multichain key | https://etherscan.io/apidashboard |
| `RPC_URL` | EVM JSON-RPC (Alchemy / Infura / self-hosted) | provider of choice |
| `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | Service-role key (bypasses RLS) | `npx supabase start` |

## Setup

```bash
cd services/ml-training
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
# fill in keys
```

Apply the Supabase migration that creates the `training_dataset` table:

```bash
# from repo root
npx supabase db reset    # local
```

## Run

```bash
# Build the dataset (defaults: 750 risky + 750 safe)
vouch-ml-training build-dataset

# Smaller smoke run
vouch-ml-training build-dataset --risky 50 --safe 50

# Train XGBoost on whatever's in training_dataset for the current featureSetVersion
vouch-ml-training train
```

The ETL is idempotent — re-running upserts on `(address, chainId, featureSetVersion)`. To start a clean dataset for a new feature schema, bump `FEATURE_SET_VERSION` in `.env`.

## Output

- **Supabase** `public.training_dataset` — labeled wallets + features. Service-role only (RLS on, no public policy).
- **Local artifact** `src/vouch_ml_training/models/artifacts/<version>/`
  - `model.joblib` — calibrated `Pipeline(SimpleImputer, XGBClassifier)` wrapped in isotonic calibration.
  - `metadata.json` — feature columns, metrics (AUC, PR-AUC, log-loss, Brier), train/val/test sizes.

The `apps/ml-engine` FastAPI service is the eventual consumer of `model.joblib`.

## What's next

- Add `aaveAvgHealthFactorAtBorrow` and `aaveTimeSinceLastBorrowDays` features (subgraph already has the data).
- Add stablecoin balance via Alchemy `alchemy_getTokenBalances` (left as a `None` column today).
- Add a `training_runs` table to track model version → metrics → dataset hash for full lineage.
- Move from "ever liquidated" to a time-bounded label (e.g. liquidated within 90 days of snapshot) to avoid leakage.
- Backfill with Vouch's own loan outcomes (`loans` table) once the protocol has real history — that's when the real model starts.
