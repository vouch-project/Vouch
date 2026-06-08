# vouch-ml-training

ETL pipeline + XGBoost trainer for the **cold-start** Vouch credit scoring model.

The pipeline:

1. Pulls Aave V3 liquidation history from The Graph (positive class — "risky").
2. Pulls Aave V3 borrowers that have never been liquidated (negative class — "safe").
3. Enriches every wallet with Etherscan + RPC metadata (age, tx count, balance, contracts touched). Etherscan responses are cached to disk (gzipped JSON) so re-runs are ~10× faster.
4. Upserts the result into the Supabase `training_dataset` table (idempotent).
5. Snapshots the table to a versioned parquet file under `data/snapshots/` for portable, reproducible training.
6. Trains an XGBoost classifier on the latest snapshot and writes a calibrated model artifact.

## Layout

```
services/ml-training/
├── pyproject.toml                       # all deps + console_script
├── .env.example
├── data/                                # gitignored
│   ├── cache/etherscan/                 # *.json.gz response cache
│   └── snapshots/                       # versioned parquet snapshots
└── src/vouch_ml_training/
    ├── cli.py                           # `vouch-ml-training` entrypoint
    ├── config.py                        # pydantic-settings, env-driven
    ├── logging.py                       # rich logger
    ├── data/
    │   ├── extract_aave.py              # The Graph queries (liquidations + borrows)
    │   ├── extract_wallets.py           # Etherscan + RPC enrichment, gzip cache
    │   ├── transform.py                 # subgraph + enrichment → TrainingRow
    │   ├── load.py                      # Supabase upsert
    │   ├── parquet_io.py                # Supabase ↔ parquet snapshots (polars)
    │   └── types.py
    ├── pipelines/
    │   ├── build_dataset.py             # ETL orchestrator
    │   └── train_xgboost.py             # trainer
    └── models/artifacts/                # versioned trained models (gitignored)
```

## Prerequisites

External services:

| Key | What | Where to get it |
| --- | --- | --- |
| `THE_GRAPH_API_KEY` | Decentralized gateway API key | https://thegraph.com/studio/apikeys/ |
| `AAVE_V3_SUBGRAPH_ID` | Aave V3 mainnet (or Sepolia) subgraph id | https://thegraph.com/explorer/ |
| `ETHERSCAN_API_KEY` | Etherscan v2 multichain key | https://etherscan.io/apidashboard |
| `RPC_URL` | EVM JSON-RPC (Alchemy / Infura / self-hosted) | provider of choice |
| `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | Service-role key (bypasses RLS) | `npx supabase status -o env` |

System:

- **Python 3.11+** (`xgboost` wheel availability may limit newer versions on some platforms).
- **macOS only:** `brew install libomp` is required before training. XGBoost links to OpenMP at runtime; the ETL itself doesn't need it.

## Setup

```bash
cd services/ml-training

# 1. venv + deps (pyproject.toml drives everything; no requirements.txt)
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

# 2. config
cp .env.example .env
# fill in keys

# 3. apply the migration (creates the training_dataset table)
cd ../..
npx supabase db reset
cd services/ml-training
```

There's no lockfile today. The `.[dev]` install reads `pyproject.toml` and resolves transitive deps fresh each time. If you want reproducible installs across machines, `pip freeze > requirements.lock` after a known-good install and commit that.

## Run

```bash
# 1. Build the dataset (defaults: 2000 risky + 2000 safe; override with flags)
vouch-ml-training build-dataset --risky 250 --safe 250

# 2. Snapshot Supabase → parquet
vouch-ml-training export-parquet

# 3. Train XGBoost on the latest parquet snapshot
vouch-ml-training train
```

### Re-run safety

- **ETL:** the `(address, chainId, featureSetVersion)` UNIQUE constraint plus `ON CONFLICT … DO UPDATE` means re-running upserts (no duplicates). To start a clean dataset for a new feature schema, bump `FEATURE_SET_VERSION` in `.env`.
- **Etherscan cache:** every response is cached at `data/cache/etherscan/<sha1>.json.gz`. Delete the directory to bust.
- **Snapshots:** every `export-parquet` writes a new timestamped file. The `*__latest.parquet` symlink (or fallback copy) always points at the most recent for a given `featureSetVersion`.

## CLI reference

| Command | What it does |
| --- | --- |
| `vouch-ml-training build-dataset` | Aave + Etherscan + RPC → upsert into Supabase. Flags: `--risky N`, `--safe N`. |
| `vouch-ml-training export-parquet` | Snapshot Supabase → versioned parquet file. |
| `vouch-ml-training train` | Read latest parquet → train XGBoost → write artifact. |

## Tools

### `scripts/check_wallet.py`

Score a single wallet with the latest trained model without running the full ETL:

```bash
cd services/ml-training
source .venv/bin/activate

# Score a wallet (uses the latest artifact automatically)
python scripts/check_wallet.py 0xabc...def

# Score with a specific artifact
python scripts/check_wallet.py 0xabc...def --artifact src/vouch_ml_training/models/artifacts/cold_start_v1-20260526T120000Z
```

Output includes `risk_probability` (calibrated), `raw_xgb_probability` (uncalibrated), all feature values, and the model version used.

## Output

- **Supabase** `public.training_dataset` — labeled wallets + features. Service-role only (RLS on, no public policy). Source of truth.
- **Parquet snapshots** `data/snapshots/<featureSetVersion>__<UTC timestamp>.parquet` — frozen, versioned, what the trainer reads.
- **Model artifact** `src/vouch_ml_training/models/artifacts/<version>/`
  - `model.joblib` — `CalibratedPipeline` wrapping a `Pipeline(SimpleImputer, XGBClassifier)` + `IsotonicRegression` calibrator. Call `model.predict_proba(X)` to get calibrated probabilities.
  - `metadata.json` — feature columns (walletAgeDays, totalTransactions, aaveBorrowsCount, aaveTotalBorrowedUsd, ethBalance, stablecoinBalanceUsd, uniqueProtocolsInteracted, aaveDaysSinceLastBorrow, aaveRepayRatio), mean CV metrics (AUC, accuracy, PR-AUC, log-loss, Brier ± std), `cv_folds`, `n_total`.

`apps/ml-engine` is the eventual consumer of `model.joblib`.

## Stack notes

- **polars** for in-memory dataframes (parquet I/O, trainer data prep). scikit-learn doesn't accept polars natively, so the trainer drops to numpy at the model boundary.
- **XGBoost** for the classifier; **isotonic calibration** so probabilities are usable as a credit-score input rather than just a ranking.
- **`SimpleImputer(strategy="median")`** handles legitimate NaNs (wallet has no Aave history, or Etherscan rate-limited a few requests).

## What's next

- Add a `training_runs` table to track model version → metrics → dataset hash for full lineage.
- Backfill with Vouch's own loan outcomes (`loans` table) once the protocol has real history — that's when the real model starts.
- Optional: pin transitive deps via a lockfile (`pip-tools` or `uv pip compile`).
