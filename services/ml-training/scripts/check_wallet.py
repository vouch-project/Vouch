"""Score a single wallet with the latest trained Vouch cold-start model.

Usage (from `services/ml-training/`):

    python scripts/check_wallet.py 0xabc...def
    python scripts/check_wallet.py 0xabc...def --artifact path/to/artifact-dir

The script enriches the wallet via Etherscan + RPC (reusing the ETL
helpers), pulls its Aave V3 borrow stats from the subgraph, builds the
feature vector in the order the model expects, and prints the calibrated
risk probability.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import joblib
import numpy as np

from vouch_ml_training.config import get_settings
from vouch_ml_training.data.extract_aave import _post_graphql, _to_usd
from vouch_ml_training.data.extract_wallets import enrich_wallets
from vouch_ml_training.logging import configure_logging, get_logger

log = get_logger(__name__)

_ARTIFACT_ROOT = (
    Path(__file__).resolve().parent.parent
    / "src" / "vouch_ml_training" / "models" / "artifacts"
)

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
    reserve { decimals symbol }
  }
}
"""

_USER_REPAYS_QUERY = """
query UserRepays($user: String!, $first: Int!, $skip: Int!) {
  repays(
    first: $first
    skip: $skip
    where: { user: $user }
    orderBy: timestamp
    orderDirection: asc
  ) {
    id
  }
}
"""


def _find_latest_artifact() -> Path:
    candidates = [
        p for p in _ARTIFACT_ROOT.iterdir()
        if p.is_dir() and (p / "model.joblib").exists()
    ]
    if not candidates:
        raise FileNotFoundError(
            f"No model artifacts found under {_ARTIFACT_ROOT}. "
            "Train one first with `vouch-ml-training train`."
        )
    # Artifact dirs are timestamped, so lexical sort == chronological.
    return sorted(candidates)[-1]


async def _fetch_user_aave_stats(
    address: str,
) -> tuple[int, float, float | None]:
    """Return (borrows_count, total_borrowed_usd, repay_ratio)."""
    settings = get_settings()
    addr = address.lower()
    total_count = 0
    total_usd = 0.0
    page_size = 1000

    async with httpx.AsyncClient() as client:
        skip = 0
        while True:
            data = await _post_graphql(
                client,
                settings.subgraph_url,
                _USER_BORROWS_QUERY,
                {"user": addr, "first": page_size, "skip": skip},
            )
            rows: list[dict[str, Any]] = data.get("borrows", [])
            if not rows:
                break
            total_count += len(rows)
            for r in rows:
                total_usd += _to_usd(
                    r["amount"],
                    int(r["reserve"]["decimals"]),
                    r["assetPriceUSD"],
                )
            if len(rows) < page_size:
                break
            skip += page_size
            # Subgraph hard caps skip at 5000; bail out gracefully.
            if skip >= 5000:
                log.warning(
                    "user has >5000 Aave borrows; truncating at subgraph skip cap"
                )
                break

        # Fetch repay count
        repay_count = 0
        skip = 0
        while True:
            data = await _post_graphql(
                client,
                settings.subgraph_url,
                _USER_REPAYS_QUERY,
                {"user": addr, "first": page_size, "skip": skip},
            )
            rows = data.get("repays", [])
            if not rows:
                break
            repay_count += len(rows)
            if len(rows) < page_size:
                break
            skip += page_size
            if skip >= 5000:
                log.warning(
                    "user has >5000 Aave repays; truncating at subgraph skip cap"
                )
                break

    repay_ratio = min(repay_count / total_count, 1.0) if total_count > 0 else None

    return total_count, total_usd, repay_ratio


async def _build_features(address: str) -> tuple[list[str], list[float | None]]:
    settings = get_settings()
    enrichments = await enrich_wallets(settings, [address])
    enr = enrichments[0]

    aave_count, aave_usd, repay_ratio = await _fetch_user_aave_stats(address)

    # Order MUST match metadata.json["feature_columns"] from the artifact.
    features: dict[str, float | None] = {
        "walletAgeDays": enr.wallet_age_days,
        "totalTransactions": enr.total_transactions,
        "aaveBorrowsCount": aave_count,
        "aaveTotalBorrowedUsd": aave_usd,
        "ethBalance": enr.eth_balance,
        "stablecoinBalanceUsd": enr.stablecoin_balance_usd,
        "uniqueProtocolsInteracted": enr.unique_protocols_interacted,
        "aaveRepayRatio": repay_ratio,
    }
    return list(features.keys()), list(features.values())


def _score(artifact_dir: Path, address: str) -> dict[str, Any]:
    metadata = json.loads((artifact_dir / "metadata.json").read_text())
    expected_cols: list[str] = metadata["feature_columns"]

    names, values = asyncio.run(_build_features(address))
    if names != expected_cols:
        raise RuntimeError(
            f"Feature ordering mismatch.\n  built:    {names}\n  expected: {expected_cols}"
        )

    model = joblib.load(artifact_dir / "model.joblib")
    x = np.array([[float(v) if v is not None else np.nan for v in values]])
    # The imputer inside the pipeline handles NaNs (median strategy).
    proba_risky = float(model.predict_proba(x)[0, 1])

    # Also expose the *uncalibrated* XGB probability for diagnostics.
    # Comparing raw vs Platt-calibrated tells you which layer drives the score.
    raw_proba_risky: float | None = None
    inner_pipeline = getattr(model, "_pipeline", None)
    if inner_pipeline is not None:
        raw_proba_risky = float(inner_pipeline.predict_proba(x)[0, 1])

    return {
        "address": address.lower(),
        "model_version": metadata["model_version"],
        "feature_set_version": metadata["feature_set_version"],
        "features": dict(zip(names, values, strict=True)),
        "risk_probability": proba_risky,
        "raw_xgb_probability": raw_proba_risky,
        "predicted_label": "risky" if proba_risky >= 0.5 else "safe",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Score one wallet with the latest model.")
    parser.add_argument("address", help="0x-prefixed wallet address")
    parser.add_argument(
        "--artifact",
        type=Path,
        default=None,
        help="Path to a specific artifact dir (defaults to the latest under models/artifacts/).",
    )
    args = parser.parse_args()

    configure_logging()
    artifact_dir = args.artifact or _find_latest_artifact()
    log.info("scoring %s with artifact %s", args.address, artifact_dir.name)

    result = _score(artifact_dir, args.address)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
