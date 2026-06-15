# ML Engine Credit Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up `apps/ml-engine` to load the trained XGBoost model artifact from `services/ml-training` and serve real 300–850 credit scores (FICO range) with per-feature strengths, risk factors, and improvement suggestions via the existing FastAPI endpoint.

> **Note:** Issue #15 originally specified a 0–1000 scale. This was intentionally changed to 300–850 (standard FICO range) during design — the FICO range is the industry standard for credit scoring and provides better UX (users recognize what 720 means). Issue #15 and any downstream consumers have been updated accordingly.

**Architecture:** `scorer.py` loads `model.joblib` + `metadata.json` from a configurable artifact path at startup, runs inference using the same feature vector as `check_wallet.py`, and converts the raw `risk_probability` into a 300–850 credit score (FICO range) down-weighted by wallet age confidence. All business logic (formula, strengths/risk_factors/improvements) lives in `scorer.py`; `main.py` stays a thin FastAPI router.

**Tech Stack:** FastAPI, joblib, numpy, scikit-learn (for `CalibratedPipeline` deserialization), httpx (subgraph + RPC calls reused from `services/ml-training`), pydantic-settings, pytest.

---

## Context for implementers

### Artifact structure (produced by `services/ml-training`)

The model artifact lives at a directory path. Two files matter:

```
<artifact_dir>/
  model.joblib      — CalibratedPipeline (joblib-serialized)
  metadata.json     — {"model_version": "...", "feature_set_version": "...",
                        "feature_columns": ["walletAgeDays", ...9 columns...]}
```

`CalibratedPipeline` is defined in `services/ml-training/src/vouch_ml_training/pipelines/train_xgboost.py`. To deserialize it in `ml-engine` **without** importing from `ml-training`, we need a local copy of the class (joblib uses pickle, which requires the class to exist at the same import path — see Task 1).

### Feature vector (9 features, order matters)

```python
["walletAgeDays", "totalTransactions", "aaveBorrowsCount", "aaveTotalBorrowedUsd",
 "ethBalance", "stablecoinBalanceUsd", "uniqueProtocolsInteracted",
 "aaveDaysSinceLastBorrow", "aaveRepayRatio"]
```

`None` values become `np.nan` — the `SimpleImputer` inside the pipeline handles them with median strategy.

### Credit score formula

Score range mirrors FICO: **300 (worst) → 850 (best)**.

FICO tiers (for display context, not hardcoded in this service):
- 800–850: Exceptional
- 740–799: Very Good
- 670–739: Good
- 580–669: Fair
- 300–579: Poor

```python
BASE_SCORE = 300
MAX_ADDITIVE = 550   # BASE_SCORE + MAX_ADDITIVE = 850 ceiling

confidence_weight = min(1.0, wallet_age_days / 365.0)  # 0→0, 365d→1.0
model_contribution = (1.0 - risk_probability) * MAX_ADDITIVE
credit_score = BASE_SCORE + round(model_contribution * confidence_weight)
```

- Wallet with age 0: score = 300 (no information — floor regardless of risk probability)
- Wallet age 6 months (182d), risk=0.5: 300 + round(275 × 0.5) = 437
- Wallet age 1yr+, risk=0.05: 300 + round(522 × 1.0) = 822
- Any wallet, risk=1.0: 300

`confidence` field = `confidence_weight` (float 0–1).

### Signal generation (strengths, risk factors, improvements)

Generate three lists: `strengths` (positive signals), `risk_factors` (negative signals), and `improvements` (actionable suggestions). All three are returned in the response; `explanation` is improvements joined with "; ".

**Strengths** — positive signals to show high scorers:
```python
strengths: list[str] = []

if wallet_age_days is not None and wallet_age_days >= 365:
    strengths.append("Long wallet history (1+ year)")
if total_transactions is not None and total_transactions >= 100:
    strengths.append("High on-chain activity")
if unique_protocols_interacted is not None and unique_protocols_interacted >= 5:
    strengths.append("Diverse DeFi protocol usage")
if aave_repay_ratio is not None and aave_repay_ratio >= 0.8:
    strengths.append("Strong Aave repayment history")
if eth_balance is not None and eth_balance >= 1.0:
    strengths.append("Healthy ETH balance")
if stablecoin_balance_usd is not None and stablecoin_balance_usd >= 500:
    strengths.append("Meaningful stablecoin reserves")
if aave_borrows_count is not None and aave_borrows_count >= 3 and aave_repay_ratio is not None and aave_repay_ratio >= 0.8:
    strengths.append("Consistent DeFi borrowing track record")
```

**Risk factors + improvements**:
```python
risk_factors: list[str] = []
improvements: list[str] = []

# Wallet age
if wallet_age_days is None or wallet_age_days < 90:
    risk_factors.append("Very new wallet (less than 3 months)")
    improvements.append("Score will increase automatically as wallet history grows")
elif wallet_age_days < 180:
    risk_factors.append("Limited wallet history (less than 6 months)")
    improvements.append("Score will increase automatically as wallet history grows")

# On-chain activity
if total_transactions is not None and total_transactions < 10:
    risk_factors.append("Very few on-chain transactions")
    improvements.append("Regular on-chain activity improves your score over time")
if unique_protocols_interacted is not None and unique_protocols_interacted < 2:
    risk_factors.append("Limited DeFi protocol usage")
    improvements.append("Interacting with multiple DeFi protocols builds a stronger profile")

# Aave signals
if aave_repay_ratio is None:
    risk_factors.append("No DeFi borrowing history")
    improvements.append("Establishing a DeFi borrowing and repayment history will improve your score")
elif aave_repay_ratio < 0.5:
    risk_factors.append("Low Aave repayment ratio")
    improvements.append("Repaying Aave borrows consistently will improve your score")
elif aave_repay_ratio < 0.8:
    risk_factors.append("Moderate Aave repayment ratio")
    improvements.append("Increasing your Aave repayment rate above 80% will improve your score")
if aave_days_since_last_borrow is not None and aave_days_since_last_borrow > 180:
    risk_factors.append("No recent DeFi borrowing activity (6+ months)")
    improvements.append("Recent borrowing activity signals active protocol engagement")
elif aave_days_since_last_borrow is not None and aave_days_since_last_borrow > 60:
    risk_factors.append("No recent DeFi borrowing activity (60+ days)")

# Balance
if eth_balance is not None and eth_balance < 0.05:
    risk_factors.append("Low ETH balance")
    improvements.append("Maintaining an ETH balance improves your score")
if stablecoin_balance_usd is not None and stablecoin_balance_usd < 50 and (eth_balance is None or eth_balance < 0.5):
    risk_factors.append("Low overall assets on-chain")
```

`explanation` field = improvements joined with "; ", or `None` if there are no improvements.

**Response schema change:** `factors` is replaced by two separate fields: `strengths: list[str]` and `risk_factors: list[str]`. The `improvements: list[str]` field is also added.

### Feature fetching

`ml-engine` must fetch the same 9 features as `check_wallet.py`. The fetching logic is **duplicated** from `services/ml-training/scripts/check_wallet.py` into a new `src/features.py` file — we do NOT import from `ml-training` (different service, different deploy unit). The implementation is a direct copy-and-adapt of the relevant async functions.

The feature fetcher needs:
- `THE_GRAPH_API_KEY` + `AAVE_V3_SUBGRAPH_ID` → subgraph URL
- `ETHERSCAN_API_KEY` + `RPC_URL` → Etherscan/RPC enrichment
- `TARGET_CHAIN_ID` (default: 1)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/ml-engine/src/config.py` | **Create** | Pydantic-settings; env vars, artifact path |
| `apps/ml-engine/src/compat.py` | **Create** | `CalibratedPipeline` stub for joblib deserialization |
| `apps/ml-engine/src/features.py` | **Create** | Async feature fetching (subgraph + RPC + Etherscan) |
| `apps/ml-engine/src/scorer.py` | **Modify** | Load model, run inference, compute credit score + explanations |
| `apps/ml-engine/src/schemas.py` | **Modify** | Add `improvements: list[str]` to `CreditScoreResponse` |
| `apps/ml-engine/main.py` | **Modify** | Pass artifact path from config to `CreditScorer` |
| `apps/ml-engine/.env.example` | **Create** | Document required env vars |
| `apps/ml-engine/pyproject.toml` | **Modify** | Add `xgboost`, `joblib`, `tenacity`, `pydantic-settings` deps |
| `apps/ml-engine/tests/test_scorer.py` | **Modify** | Add tests for score formula and explanation generation |
| `apps/ml-engine/tests/test_features.py` | **Create** | Unit tests for feature-building helpers (no network) |

---

## Task 1: CalibratedPipeline compat stub + config

`CalibratedPipeline` was serialized by joblib from `ml-training`. Joblib/pickle requires the class at the same module path it was pickled from: `vouch_ml_training.pipelines.train_xgboost.CalibratedPipeline`. The cleanest solution is a `src/compat.py` that registers the class at that dotted path by monkeypatching `sys.modules` — one function called at startup before `joblib.load`.

**Files:**
- Create: `apps/ml-engine/src/config.py`
- Create: `apps/ml-engine/src/compat.py`
- Create: `apps/ml-engine/.env.example`
- Modify: `apps/ml-engine/pyproject.toml`

- [ ] **Step 1: Add missing dependencies to pyproject.toml**

Open `apps/ml-engine/pyproject.toml` and update the `dependencies` list:

```toml
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "scikit-learn>=1.6.0",
    "xgboost>=2.0.0",
    "joblib>=1.3.0",
    "pandas>=2.2.0",
    "numpy>=2.0.0",
    "pydantic>=2.10.0",
    "pydantic-settings>=2.0.0",
    "httpx>=0.28.0",
    "tenacity>=8.0.0",
]
```

- [ ] **Step 2: Write the failing config test**

```python
# apps/ml-engine/tests/test_config.py
import os
import pytest
from src.config import Settings

def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("THE_GRAPH_API_KEY", "test-key")
    monkeypatch.setenv("AAVE_V3_SUBGRAPH_ID", "test-subgraph-id")
    monkeypatch.setenv("ETHERSCAN_API_KEY", "test-etherscan")
    monkeypatch.setenv("RPC_URL", "https://rpc.example.com")
    s = Settings()
    assert s.the_graph_api_key == "test-key"
    assert s.subgraph_url == "https://gateway.thegraph.com/api/test-key/subgraphs/id/test-subgraph-id"
    assert s.target_chain_id == 1

def test_settings_artifact_path_default(monkeypatch, tmp_path):
    monkeypatch.setenv("THE_GRAPH_API_KEY", "k")
    monkeypatch.setenv("AAVE_V3_SUBGRAPH_ID", "s")
    monkeypatch.setenv("ETHERSCAN_API_KEY", "e")
    monkeypatch.setenv("RPC_URL", "https://rpc.example.com")
    s = Settings()
    # default artifact path ends with models/artifacts
    assert s.artifact_path is None or str(s.artifact_path).endswith("artifacts")
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/ml-engine
source .venv/bin/activate
pytest tests/test_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.config'`

- [ ] **Step 4: Create `src/config.py`**

```python
# apps/ml-engine/src/config.py
from __future__ import annotations
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    the_graph_api_key: str
    aave_v3_subgraph_id: str
    etherscan_api_key: str
    rpc_url: str
    target_chain_id: int = 1
    etherscan_base_url: str = "https://api.etherscan.io/v2/api"
    http_concurrency: int = 4
    etherscan_rps: float = 2.5

    # Path to a specific artifact dir. If None, the scorer auto-selects the latest.
    artifact_path: Path | None = None

    @property
    def subgraph_url(self) -> str:
        return (
            f"https://gateway.thegraph.com/api/{self.the_graph_api_key}"
            f"/subgraphs/id/{self.aave_v3_subgraph_id}"
        )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
```

- [ ] **Step 5: Run config test to verify it passes**

```bash
pytest tests/test_config.py -v
```

Expected: PASS (2 tests)

- [ ] **Step 6: Create `src/compat.py`**

Joblib/pickle requires `CalibratedPipeline` to be importable from the exact module path it was pickled from: `vouch_ml_training.pipelines.train_xgboost`. This stub registers a fake module so joblib finds the class.

```python
# apps/ml-engine/src/compat.py
"""Pickle compatibility shim for CalibratedPipeline from ml-training.

joblib.load() uses pickle, which requires the class to be importable from
the exact dotted path it was serialized under. The model was trained in
services/ml-training where the class lives at
vouch_ml_training.pipelines.train_xgboost.CalibratedPipeline.

We register a minimal stub at that path so deserialization works without
importing ml-training as a package.
"""
from __future__ import annotations
import sys
import types
import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.pipeline import Pipeline


class CalibratedPipeline:
    def __init__(self, pipeline: Pipeline, calibrator: IsotonicRegression) -> None:
        self._pipeline = pipeline
        self._calibrator = calibrator

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        raw = self._pipeline.predict_proba(x)[:, 1]
        cal = self._calibrator.predict(raw)
        return np.column_stack([1 - cal, cal])

    def predict(self, x: np.ndarray) -> np.ndarray:
        return (self.predict_proba(x)[:, 1] >= 0.5).astype(int)


def register() -> None:
    """Call once at startup before any joblib.load() of an ml-training artifact."""
    pkg = types.ModuleType("vouch_ml_training")
    sub = types.ModuleType("vouch_ml_training.pipelines")
    mod = types.ModuleType("vouch_ml_training.pipelines.train_xgboost")
    mod.CalibratedPipeline = CalibratedPipeline  # type: ignore[attr-defined]
    sys.modules.setdefault("vouch_ml_training", pkg)
    sys.modules.setdefault("vouch_ml_training.pipelines", sub)
    sys.modules.setdefault("vouch_ml_training.pipelines.train_xgboost", mod)
```

- [ ] **Step 7: Create `.env.example`**

```bash
# apps/ml-engine/.env.example
THE_GRAPH_API_KEY=your-graph-api-key
AAVE_V3_SUBGRAPH_ID=your-aave-v3-subgraph-id
ETHERSCAN_API_KEY=your-etherscan-api-key
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-key
TARGET_CHAIN_ID=1

# Optional: pin to a specific artifact dir. Defaults to the latest under
# services/ml-training/src/vouch_ml_training/models/artifacts/
# ARTIFACT_PATH=/path/to/cold_start_v1-20260608T213645Z
```

- [ ] **Step 8: Reinstall deps**

```bash
cd apps/ml-engine
pip install -e '.[dev]'
```

- [ ] **Step 9: Commit**

```bash
git add apps/ml-engine/src/config.py apps/ml-engine/src/compat.py \
        apps/ml-engine/tests/test_config.py apps/ml-engine/.env.example \
        apps/ml-engine/pyproject.toml
git commit -m "feat(ml-engine): add config and CalibratedPipeline compat stub"
```

---

## Task 2: Feature fetching

Create `src/features.py` — an async function that takes a wallet address and returns a dict of the 9 feature values. This is adapted from `services/ml-training/scripts/check_wallet.py` (specifically `_build_features`, `_fetch_user_aave_stats`, and the Etherscan enrichment), but self-contained in ml-engine.

The Etherscan enrichment is complex (rate limiter, retry, RPC batch calls). Rather than duplicating all of it, `features.py` calls the ml-training helpers **only if the packages are installed in the same venv** — but since they won't be in production, we copy the minimal subset needed. See below for what to copy.

**Files:**
- Create: `apps/ml-engine/src/features.py`
- Create: `apps/ml-engine/tests/test_features.py`

- [ ] **Step 1: Write failing tests for feature helpers**

```python
# apps/ml-engine/tests/test_features.py
import pytest
from src.features import _compute_days_since, _compute_repay_ratio

def test_days_since_returns_none_for_no_timestamp():
    assert _compute_days_since(None) is None

def test_days_since_returns_int():
    import time
    ts = int(time.time()) - 86400 * 10  # 10 days ago
    result = _compute_days_since(ts)
    assert result == 10

def test_repay_ratio_basic():
    assert _compute_repay_ratio(3, 4) == 0.75

def test_repay_ratio_capped():
    assert _compute_repay_ratio(10, 4) == 1.0

def test_repay_ratio_zero_borrows():
    assert _compute_repay_ratio(0, 0) is None

def test_repay_ratio_zero_repays():
    assert _compute_repay_ratio(0, 5) == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_features.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.features'`

- [ ] **Step 3: Create `src/features.py`**

```python
# apps/ml-engine/src/features.py
"""Fetch the 9-feature vector for a wallet address (subgraph + RPC + Etherscan).

Adapted from services/ml-training/scripts/check_wallet.py. Self-contained —
does not import from the ml-training package.
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import Settings, get_settings

# ---------------------------------------------------------------------------
# Etherscan disk cache (same pattern as ml-training)
# ---------------------------------------------------------------------------
_CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "cache" / "etherscan"

_STABLECOIN_CONTRACTS: list[tuple[str, int]] = [
    ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    ("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
]
_BALANCE_OF_SELECTOR = "0x70a08231"

# ---------------------------------------------------------------------------
# Subgraph queries
# ---------------------------------------------------------------------------
_USER_BORROWS_QUERY = """
query UserBorrows($user: String!, $first: Int!, $skip: Int!) {
  borrows(
    first: $first
    skip: $skip
    where: { user: $user }
    orderBy: timestamp
    orderDirection: asc
  ) {
    id
    timestamp
    amount
    assetPriceUSD
    reserve { decimals }
  }
}
"""

_USER_REPAYS_QUERY = """
query UserRepays($user: String!, $first: Int!, $skip: Int!) {
  repays(first: $first skip: $skip where: { user: $user }
         orderBy: timestamp orderDirection: asc) { id }
}
"""


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable, no I/O)
# ---------------------------------------------------------------------------

def _compute_days_since(unix_ts: int | None) -> int | None:
    if unix_ts is None:
        return None
    return max(0, (int(time.time()) - unix_ts) // 86400)


def _compute_repay_ratio(repay_count: int, borrow_count: int) -> float | None:
    if borrow_count == 0:
        return None
    return min(repay_count / borrow_count, 1.0)


def _to_usd(amount_raw: str, decimals: int, price_usd: str) -> float:
    return int(amount_raw) / (10 ** decimals) * float(price_usd)


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------
class _RateLimiter:
    def __init__(self, rps: float) -> None:
        self._interval = 1.0 / max(rps, 0.1)
        self._next_slot = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            sleep_for = max(0.0, self._next_slot - now)
            if sleep_for:
                await asyncio.sleep(sleep_for)
            self._next_slot = max(now, self._next_slot) + self._interval


# ---------------------------------------------------------------------------
# Etherscan helpers
# ---------------------------------------------------------------------------
@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=1, min=1, max=10), reraise=True)
async def _etherscan_call(
    client: httpx.AsyncClient,
    settings: Settings,
    params: dict[str, Any],
    limiter: _RateLimiter,
) -> dict[str, Any]:
    cache_material = {"params": params, "chainid": settings.target_chain_id,
                      "base_url": settings.etherscan_base_url}
    cache_key = hashlib.sha1(
        json.dumps(cache_material, sort_keys=True).encode(), usedforsecurity=False
    ).hexdigest()
    cache_file = _CACHE_DIR / f"{cache_key}.json.gz"
    if cache_file.exists():
        try:
            with gzip.open(cache_file, "rt", encoding="utf-8") as fh:
                return json.load(fh)  # type: ignore[no-any-return]
        except (json.JSONDecodeError, OSError):
            cache_file.unlink(missing_ok=True)

    await limiter.acquire()
    full_params = {**params, "chainid": settings.target_chain_id,
                   "apikey": settings.etherscan_api_key}
    resp = await client.get(settings.etherscan_base_url, params=full_params, timeout=30.0)
    resp.raise_for_status()
    body: dict[str, Any] = resp.json()
    result = body.get("result")
    if body.get("status") == "0" and isinstance(result, str):
        msg = result.lower()
        if "rate limit" in msg or "max calls" in msg or "too many" in msg:
            raise RuntimeError(f"Etherscan rate limited: {result}")
        if "no transactions found" not in msg:
            raise RuntimeError(f"Etherscan error: {result}")

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(cache_file, "wt", encoding="utf-8") as fh:
        json.dump(body, fh)
    return body


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=1, max=30), reraise=True)
async def _rpc_batch(
    client: httpx.AsyncClient,
    settings: Settings,
    calls: list[tuple[str, list[Any]]],
) -> list[Any]:
    payload = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p}
               for i, (m, p) in enumerate(calls)]
    resp = await client.post(settings.rpc_url, json=payload, timeout=30.0)
    resp.raise_for_status()
    body = resp.json()
    by_id = {item["id"]: item for item in body}
    out: list[Any] = []
    for i, (method, _) in enumerate(calls):
        item = by_id.get(i, {})
        if "error" in item:
            raise RuntimeError(f"RPC error for {method}: {item['error']}")
        out.append(item.get("result"))
    return out


async def _fetch_stablecoin_balance(
    client: httpx.AsyncClient, settings: Settings, address: str
) -> float:
    addr_padded = address.lower().replace("0x", "").zfill(64)
    calldata = f"{_BALANCE_OF_SELECTOR}{addr_padded}"
    calls = [("eth_call", [{"to": c, "data": calldata}, "latest"])
              for c, _ in _STABLECOIN_CONTRACTS]
    results = await _rpc_batch(client, settings, calls)
    total = 0.0
    for raw_hex, (_, decimals) in zip(results, _STABLECOIN_CONTRACTS):
        if raw_hex and raw_hex != "0x":
            total += int(raw_hex, 16) / (10 ** decimals)
    return total


# ---------------------------------------------------------------------------
# Subgraph helpers
# ---------------------------------------------------------------------------
async def _post_graphql(
    client: httpx.AsyncClient, url: str, query: str, variables: dict[str, Any]
) -> dict[str, Any]:
    resp = await client.post(url, json={"query": query, "variables": variables}, timeout=30.0)
    resp.raise_for_status()
    body = resp.json()
    if "errors" in body:
        raise RuntimeError(f"GraphQL errors: {body['errors']}")
    return body.get("data", {})


async def _fetch_aave_stats(
    client: httpx.AsyncClient, settings: Settings, address: str
) -> tuple[int, float, float | None, int | None]:
    """Return (borrows_count, total_usd, repay_ratio, last_borrow_ts)."""
    addr = address.lower()
    total_count = 0
    total_usd = 0.0
    last_borrow_ts: int | None = None
    page_size = 1000

    skip = 0
    while True:
        data = await _post_graphql(client, settings.subgraph_url, _USER_BORROWS_QUERY,
                                   {"user": addr, "first": page_size, "skip": skip})
        rows: list[dict[str, Any]] = data.get("borrows", [])
        if not rows:
            break
        total_count += len(rows)
        for r in rows:
            total_usd += _to_usd(r["amount"], int(r["reserve"]["decimals"]), r["assetPriceUSD"])
            ts = int(r["timestamp"])
            if last_borrow_ts is None or ts > last_borrow_ts:
                last_borrow_ts = ts
        if len(rows) < page_size:
            break
        skip += page_size
        if skip >= 5000:
            break

    repay_count = 0
    skip = 0
    while True:
        data = await _post_graphql(client, settings.subgraph_url, _USER_REPAYS_QUERY,
                                   {"user": addr, "first": page_size, "skip": skip})
        rows = data.get("repays", [])
        if not rows:
            break
        repay_count += len(rows)
        if len(rows) < page_size:
            break
        skip += page_size
        if skip >= 5000:
            break

    return total_count, total_usd, _compute_repay_ratio(repay_count, total_count), last_borrow_ts


# ---------------------------------------------------------------------------
# Top-level: build the full 9-feature dict for a wallet
# ---------------------------------------------------------------------------
async def fetch_features(address: str) -> dict[str, float | None]:
    """Return the 9-feature dict in FEATURE_COLUMNS order."""
    settings = get_settings()
    limiter = _RateLimiter(settings.etherscan_rps)
    semaphore = asyncio.Semaphore(settings.http_concurrency)

    async with httpx.AsyncClient() as client:
        async with semaphore:
            # Etherscan: tx list for age + unique contracts
            tx_resp = await _etherscan_call(
                client, settings,
                {"module": "account", "action": "txlist", "address": address,
                 "startblock": 0, "endblock": 99999999, "page": 1, "offset": 10000, "sort": "asc"},
                limiter,
            )
            wallet_age_days: int | None = None
            unique_contracts: int | None = None
            tx_list = tx_resp.get("result")
            if isinstance(tx_list, list) and tx_list:
                first_ts = int(tx_list[0]["timeStamp"])
                wallet_age_days = max(0, (int(time.time()) - first_ts) // 86400)
                contracts = {(t.get("to") or "").lower() for t in tx_list if t.get("to")}
                contracts.discard("")
                unique_contracts = len(contracts)

            # RPC: nonce + ETH balance
            nonce_hex, balance_hex = await _rpc_batch(client, settings, [
                ("eth_getTransactionCount", [address, "latest"]),
                ("eth_getBalance", [address, "latest"]),
            ])
            total_tx = int(nonce_hex, 16)
            eth_balance = int(balance_hex, 16) / 1e18

            stablecoin_usd = await _fetch_stablecoin_balance(client, settings, address)

            aave_count, aave_usd, repay_ratio, last_borrow_ts = await _fetch_aave_stats(
                client, settings, address
            )

    return {
        "walletAgeDays": wallet_age_days,
        "totalTransactions": total_tx,
        "aaveBorrowsCount": aave_count,
        "aaveTotalBorrowedUsd": aave_usd,
        "ethBalance": eth_balance,
        "stablecoinBalanceUsd": stablecoin_usd,
        "uniqueProtocolsInteracted": unique_contracts,
        "aaveDaysSinceLastBorrow": _compute_days_since(last_borrow_ts),
        "aaveRepayRatio": repay_ratio,
    }
```

- [ ] **Step 4: Run feature tests to verify they pass**

```bash
pytest tests/test_features.py -v
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ml-engine/src/features.py apps/ml-engine/tests/test_features.py
git commit -m "feat(ml-engine): add feature fetching layer (subgraph + RPC + Etherscan)"
```

---

## Task 3: Scorer — model loading + credit score formula

Replace the stub in `scorer.py` with real inference. The scorer loads the artifact at init time, runs inference via `CalibratedPipeline.predict_proba`, applies the credit score formula, and generates factors + improvements.

**Files:**
- Modify: `apps/ml-engine/src/scorer.py`
- Modify: `apps/ml-engine/src/schemas.py`
- Modify: `apps/ml-engine/tests/test_scorer.py`

- [ ] **Step 1: Update `schemas.py` — replace `factors` with `strengths` + `risk_factors` + `improvements`**

```python
# apps/ml-engine/src/schemas.py
from pydantic import BaseModel


class CreditScoreResponse(BaseModel):
    address: str
    score: int                    # 300–850 (FICO range)
    confidence: float             # 0.0–1.0 (wallet age weight)
    strengths: list[str]          # positive signals
    risk_factors: list[str]       # negative signals
    improvements: list[str]       # actionable suggestions
    model_version: str
    explanation: str | None = None  # improvements joined with "; "
```

- [ ] **Step 2: Write failing scorer tests**

Add these tests to `apps/ml-engine/tests/test_scorer.py` (keep existing tests, append new ones):

```python
import pytest
from src.scorer import CreditScorer, ScoringResult, _compute_credit_score, _generate_signals

# --- pure formula tests (no model needed) ---

def test_credit_score_zero_age():
    # confidence_weight = 0 → score = BASE_SCORE = 300
    assert _compute_credit_score(risk_probability=0.1, wallet_age_days=0) == 300

def test_credit_score_full_age_low_risk():
    # confidence=1.0, risk=0.05 → 300 + round(0.95*550*1.0) = 300 + 522 = 822
    assert _compute_credit_score(risk_probability=0.05, wallet_age_days=365) == 822

def test_credit_score_full_age_full_risk():
    # risk=1.0 → additive=0 → 300
    assert _compute_credit_score(risk_probability=1.0, wallet_age_days=365) == 300

def test_credit_score_half_age():
    # confidence=182/365≈0.499, risk=0.0 → 300 + round(550*0.499) = 300 + 274 = 574
    result = _compute_credit_score(risk_probability=0.0, wallet_age_days=182)
    assert 570 <= result <= 578  # allow rounding variance

def test_credit_score_none_age_uses_zero():
    assert _compute_credit_score(risk_probability=0.0, wallet_age_days=None) == 300

def test_score_in_fico_range():
    for risk in [0.0, 0.5, 1.0]:
        for age in [0, 180, 365, 730]:
            s = _compute_credit_score(risk, age)
            assert 300 <= s <= 850, f"score={s} out of FICO range for risk={risk} age={age}"

# --- signal generation tests ---

def test_signals_very_new_wallet():
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=30, total_transactions=5,
        unique_protocols_interacted=1, aave_repay_ratio=None,
        aave_days_since_last_borrow=None, aave_borrows_count=0,
        eth_balance=1.0, stablecoin_balance_usd=0.0,
    )
    assert any("Very new wallet" in f for f in risk_factors)
    assert any("history grows" in i for i in improvements)

def test_signals_no_defi_history():
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=400, total_transactions=50,
        unique_protocols_interacted=1, aave_repay_ratio=None,
        aave_days_since_last_borrow=None, aave_borrows_count=0,
        eth_balance=1.0, stablecoin_balance_usd=0.0,
    )
    assert any("No DeFi borrowing" in f for f in risk_factors)

def test_signals_low_repay_ratio():
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=400, total_transactions=50,
        unique_protocols_interacted=3, aave_repay_ratio=0.3,
        aave_days_since_last_borrow=5, aave_borrows_count=5,
        eth_balance=1.0, stablecoin_balance_usd=0.0,
    )
    assert any("repayment ratio" in f for f in risk_factors)
    assert any("repayment rate" in i for i in improvements)

def test_signals_healthy_wallet_has_strengths():
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=730, total_transactions=200,
        unique_protocols_interacted=8, aave_repay_ratio=0.9,
        aave_days_since_last_borrow=10, aave_borrows_count=10,
        eth_balance=2.0, stablecoin_balance_usd=1000.0,
    )
    assert len(strengths) >= 3
    assert risk_factors == []
    assert improvements == []

def test_signals_high_repay_ratio_is_strength():
    strengths, _, _ = _generate_signals(
        wallet_age_days=730, total_transactions=200,
        unique_protocols_interacted=8, aave_repay_ratio=0.85,
        aave_days_since_last_borrow=10, aave_borrows_count=10,
        eth_balance=2.0, stablecoin_balance_usd=0.0,
    )
    assert any("repayment" in s for s in strengths)
```

- [ ] **Step 3: Run new tests to verify they fail**

```bash
pytest tests/test_scorer.py -v -k "credit_score or signals"
```

Expected: `ImportError` — `_compute_credit_score` and `_generate_signals` not defined yet.

- [ ] **Step 4: Rewrite `src/scorer.py`**

```python
# apps/ml-engine/src/scorer.py
"""Credit scoring logic — loads model artifact and runs inference."""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np

from src.compat import register as _register_compat
from src.config import get_settings
from src.features import fetch_features

_register_compat()

_ARTIFACT_ROOT = (
    Path(__file__).resolve().parents[2]
    / "services" / "ml-training" / "src"
    / "vouch_ml_training" / "models" / "artifacts"
)

_FEATURE_COLUMNS = [
    "walletAgeDays", "totalTransactions", "aaveBorrowsCount",
    "aaveTotalBorrowedUsd", "ethBalance", "stablecoinBalanceUsd",
    "uniqueProtocolsInteracted", "aaveDaysSinceLastBorrow", "aaveRepayRatio",
]

BASE_SCORE = 300
MAX_ADDITIVE = 550  # 300 + 550 = 850 ceiling (FICO range)


@dataclass
class ScoringResult:
    score: int            # 300–850
    confidence: float     # 0.0–1.0
    strengths: list[str]
    risk_factors: list[str]
    improvements: list[str]
    model_version: str
    explanation: str | None = None


def _compute_credit_score(risk_probability: float, wallet_age_days: int | None) -> int:
    age = wallet_age_days or 0
    confidence_weight = min(1.0, age / 365.0)
    additive = (1.0 - risk_probability) * MAX_ADDITIVE
    return BASE_SCORE + round(additive * confidence_weight)


def _generate_signals(
    wallet_age_days: int | None,
    total_transactions: int | None,
    unique_protocols_interacted: int | None,
    aave_repay_ratio: float | None,
    aave_days_since_last_borrow: int | None,
    aave_borrows_count: int | None,
    eth_balance: float | None,
    stablecoin_balance_usd: float | None,
) -> tuple[list[str], list[str], list[str]]:
    """Return (strengths, risk_factors, improvements)."""
    strengths: list[str] = []
    risk_factors: list[str] = []
    improvements: list[str] = []

    age = wallet_age_days or 0

    # --- Strengths ---
    if wallet_age_days is not None and wallet_age_days >= 365:
        strengths.append("Long wallet history (1+ year)")
    if total_transactions is not None and total_transactions >= 100:
        strengths.append("High on-chain activity")
    if unique_protocols_interacted is not None and unique_protocols_interacted >= 5:
        strengths.append("Diverse DeFi protocol usage")
    if aave_repay_ratio is not None and aave_repay_ratio >= 0.8:
        strengths.append("Strong Aave repayment history")
    if eth_balance is not None and eth_balance >= 1.0:
        strengths.append("Healthy ETH balance")
    if stablecoin_balance_usd is not None and stablecoin_balance_usd >= 500:
        strengths.append("Meaningful stablecoin reserves")
    if (
        aave_borrows_count is not None and aave_borrows_count >= 3
        and aave_repay_ratio is not None and aave_repay_ratio >= 0.8
    ):
        strengths.append("Consistent DeFi borrowing track record")

    # --- Risk factors + improvements ---

    # Wallet age
    if age < 90:
        risk_factors.append("Very new wallet (less than 3 months)")
        improvements.append("Score will increase automatically as wallet history grows")
    elif age < 180:
        risk_factors.append("Limited wallet history (less than 6 months)")
        improvements.append("Score will increase automatically as wallet history grows")

    # On-chain activity
    if total_transactions is not None and total_transactions < 10:
        risk_factors.append("Very few on-chain transactions")
        improvements.append("Regular on-chain activity improves your score over time")
    if unique_protocols_interacted is not None and unique_protocols_interacted < 2:
        risk_factors.append("Limited DeFi protocol usage")
        improvements.append("Interacting with multiple DeFi protocols builds a stronger profile")

    # Aave signals
    if aave_repay_ratio is None:
        risk_factors.append("No DeFi borrowing history")
        improvements.append(
            "Establishing a DeFi borrowing and repayment history will improve your score"
        )
    elif aave_repay_ratio < 0.5:
        risk_factors.append("Low Aave repayment ratio")
        improvements.append("Repaying Aave borrows consistently will improve your score")
    elif aave_repay_ratio < 0.8:
        risk_factors.append("Moderate Aave repayment ratio")
        improvements.append(
            "Increasing your Aave repayment rate above 80% will improve your score"
        )
    if aave_days_since_last_borrow is not None and aave_days_since_last_borrow > 180:
        risk_factors.append("No recent DeFi borrowing activity (6+ months)")
        improvements.append("Recent borrowing activity signals active protocol engagement")
    elif aave_days_since_last_borrow is not None and aave_days_since_last_borrow > 60:
        risk_factors.append("No recent DeFi borrowing activity (60+ days)")

    # Balance
    if eth_balance is not None and eth_balance < 0.05:
        risk_factors.append("Low ETH balance")
        improvements.append("Maintaining an ETH balance improves your score")
    if (
        stablecoin_balance_usd is not None and stablecoin_balance_usd < 50
        and (eth_balance is None or eth_balance < 0.5)
    ):
        risk_factors.append("Low overall assets on-chain")

    return strengths, risk_factors, improvements


def _find_latest_artifact(root: Path) -> Path:
    candidates = [p for p in root.iterdir() if p.is_dir() and (p / "model.joblib").exists()]
    if not candidates:
        raise FileNotFoundError(
            f"No model artifacts found under {root}. "
            "Train one first with `vouch-ml-training train`."
        )
    return sorted(candidates)[-1]


class CreditScorer:
    def __init__(self) -> None:
        self._model: object | None = None
        self._model_version: str = "none"
        self._feature_columns: list[str] = _FEATURE_COLUMNS

        settings = get_settings()
        artifact_dir = settings.artifact_path or _find_latest_artifact(_ARTIFACT_ROOT)
        try:
            self._load(artifact_dir)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Could not load model artifact: %s", exc)

    def _load(self, artifact_dir: Path) -> None:
        metadata = json.loads((artifact_dir / "metadata.json").read_text())
        self._model = joblib.load(artifact_dir / "model.joblib")
        self._model_version = metadata["model_version"]
        self._feature_columns = metadata["feature_columns"]

    def is_ready(self) -> bool:
        return self._model is not None

    def score(self, address: str) -> ScoringResult:
        if not self.is_ready():
            return ScoringResult(
                score=0,
                confidence=0.0,
                strengths=[],
                risk_factors=[],
                improvements=[],
                model_version=self._model_version,
            )

        features = asyncio.run(fetch_features(address))
        x = np.array([[
            float(features[col]) if features.get(col) is not None else np.nan
            for col in self._feature_columns
        ]])

        risk_probability = float(self._model.predict_proba(x)[0, 1])  # type: ignore[union-attr]

        wallet_age = features.get("walletAgeDays")
        wallet_age_days = int(wallet_age) if wallet_age is not None else None
        confidence_weight = min(1.0, (wallet_age_days or 0) / 365.0)
        credit_score = _compute_credit_score(risk_probability, wallet_age_days)

        total_tx = features.get("totalTransactions")
        strengths, risk_factors, improvements = _generate_signals(
            wallet_age_days=wallet_age_days,
            total_transactions=int(total_tx) if total_tx is not None else None,
            unique_protocols_interacted=features.get("uniqueProtocolsInteracted"),
            aave_repay_ratio=features.get("aaveRepayRatio"),
            aave_days_since_last_borrow=features.get("aaveDaysSinceLastBorrow"),
            aave_borrows_count=features.get("aaveBorrowsCount"),
            eth_balance=features.get("ethBalance"),
            stablecoin_balance_usd=features.get("stablecoinBalanceUsd"),
        )

        return ScoringResult(
            score=credit_score,
            confidence=round(confidence_weight, 4),
            strengths=strengths,
            risk_factors=risk_factors,
            improvements=improvements,
            model_version=self._model_version,
            explanation="; ".join(improvements) if improvements else None,
        )
```

- [ ] **Step 5: Update existing stub test and run all scorer tests**

Update the existing `test_scorer_returns_stub_when_no_model` test — `ScoringResult` now has `strengths`, `risk_factors`, and `improvements` instead of `factors`:

```python
def test_scorer_returns_stub_when_no_model() -> None:
    scorer = CreditScorer()
    result = scorer.score("0x1234567890abcdef1234567890abcdef12345678")
    assert isinstance(result, ScoringResult)
    assert result.score == 0
    assert result.confidence == 0.0
    assert result.strengths == []
    assert result.risk_factors == []
    assert result.improvements == []
    assert result.model_version == "none"
```

Then run:

```bash
pytest tests/test_scorer.py -v
```

Expected: PASS (all tests)

- [ ] **Step 6: Update `main.py` to pass strengths, risk_factors, improvements through**

```python
# apps/ml-engine/main.py
"""Vouch Credit Scoring ML Engine."""
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from src.schemas import CreditScoreResponse
from src.scorer import CreditScorer

app = FastAPI(
    title="Vouch ML Engine",
    description="Credit scoring and risk assessment service for the Vouch lending protocol.",
    version="0.1.0",
)

scorer = CreditScorer()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ml-engine"}


@app.get("/api/v1/score/{address}", response_model=CreditScoreResponse)
async def get_credit_score(address: str) -> CreditScoreResponse | JSONResponse:
    if not scorer.is_ready():
        return JSONResponse(
            status_code=503,
            content={"detail": "Model not loaded — run training pipeline first."},
        )

    result = scorer.score(address)
    return CreditScoreResponse(
        address=address,
        score=result.score,
        confidence=result.confidence,
        strengths=result.strengths,
        risk_factors=result.risk_factors,
        improvements=result.improvements,
        model_version=result.model_version,
        explanation=result.explanation,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

- [ ] **Step 7: Run all tests**

```bash
pytest tests/ -v
```

Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add apps/ml-engine/src/scorer.py apps/ml-engine/src/schemas.py \
        apps/ml-engine/main.py apps/ml-engine/tests/test_scorer.py
git commit -m "feat(ml-engine): implement real credit scoring with formula and explanations"
```

---

## Task 4: Smoke test end-to-end

Verify the running service returns a real score for a known wallet.

**Files:** none new

- [ ] **Step 1: Copy `.env.example` to `.env` and fill in keys**

```bash
cd apps/ml-engine
cp .env.example .env
# Fill in THE_GRAPH_API_KEY, AAVE_V3_SUBGRAPH_ID, ETHERSCAN_API_KEY, RPC_URL
# Optionally set ARTIFACT_PATH to the artifact trained in services/ml-training
```

- [ ] **Step 2: Start the service**

```bash
cd apps/ml-engine
source .venv/bin/activate
uvicorn main:app --port 8001 --reload
```

Expected: startup logs show "Model loaded" (no 503 on ready check)

- [ ] **Step 3: Smoke test the health endpoint**

```bash
curl http://localhost:8001/health
```

Expected:
```json
{"status": "ok", "service": "ml-engine"}
```

- [ ] **Step 4: Score a known wallet**

Use the same risky wallet from development (`0x536b42cb48ad77d8c6c3aa1e994107d20ddcca7a` — confirmed risky in training data):

```bash
curl http://localhost:8001/api/v1/score/0x536b42cb48ad77d8c6c3aa1e994107d20ddcca7a | python3 -m json.tool
```

Expected: `score` between 300–400. `risk_factors` should include "Low Aave repayment ratio" or similar. `strengths` may include "Long wallet history" if the wallet is old. `confidence` should be close to 1.0 (wallet is old).

- [ ] **Step 5: Commit**

```bash
git add apps/ml-engine/.env.example  # already committed; nothing new to add
git commit -m "chore(ml-engine): smoke tested end-to-end scoring"
```

---

## Self-Review

**Spec coverage:**
- ✅ Model artifact loaded at startup from configurable path
- ✅ CalibratedPipeline deserialization (compat stub)
- ✅ 9-feature vector fetched from subgraph + RPC + Etherscan
- ✅ Credit score formula (300–850 FICO range, base 300, confidence-weighted by wallet age)
- ✅ Wallet age confidence weighting (0d→300, 365d→full model contribution)
- ✅ FICO tier thresholds documented (300–579 Poor / 580–669 Fair / 670–739 Good / 740–799 Very Good / 800–850 Exceptional)
- ✅ `strengths` list — positive signals for well-scored wallets
- ✅ `risk_factors` list — negative signals with graded severity (e.g. <90d vs <180d wallet age)
- ✅ `improvements` list — actionable, non-Aave-specific suggestions
- ✅ `explanation` field (improvements joined with "; ")
- ✅ Schema updated: `factors` → `strengths` + `risk_factors` + `improvements`
- ✅ Graceful degradation when no model loaded (503)
- ✅ Tests for formula, signals (both positive and negative), and feature helpers

**Placeholder scan:** None found.

**Type consistency:** `ScoringResult` fields `strengths`, `risk_factors`, `improvements` defined in Task 3 Step 4. `CreditScoreResponse` schema updated in Step 1. `_compute_credit_score` and `_generate_signals` defined in scorer.py and tested with matching signatures. `main.py` passes all three new fields.
