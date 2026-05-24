"""Train an XGBoost classifier on the populated training_dataset table.

Reads from the latest parquet snapshot (preferred) or, if missing, falls
back to a live Supabase read. Runs a stratified train/val/test split,
fits XGBoost with isotonic probability calibration, and writes the model
artifact to `services/ml-training/src/vouch_ml_training/models/artifacts/<version>/`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import polars as pl
from sklearn.calibration import CalibratedClassifierCV
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from vouch_ml_training.config import Settings, get_settings
from vouch_ml_training.data.load import get_supabase_client
from vouch_ml_training.logging import get_logger

log = get_logger(__name__)

FEATURE_COLUMNS: list[str] = [
    "walletAgeDays",
    "totalTransactions",
    "aaveBorrowsCount",
    "aaveTotalBorrowedUsd",
    "ethBalance",
    "stablecoinBalanceUsd",
    "uniqueProtocolsInteracted",
]
LABEL_COLUMN = "labelIsRisky"

_ARTIFACT_ROOT = Path(__file__).resolve().parents[1] / "models" / "artifacts"


@dataclass
class TrainingResult:
    model_version: str
    artifact_dir: Path
    metrics: dict[str, float]
    n_train: int
    n_val: int
    n_test: int


def _load_dataframe(settings: Settings) -> pl.DataFrame:
    """Load training data, preferring a parquet snapshot over Supabase.

    Snapshots are produced by `vouch-ml-training export-parquet`. If no
    snapshot exists yet we fall back to a live Supabase read so the
    trainer still works end-to-end on a fresh setup.
    """
    from vouch_ml_training.data.parquet_io import load_latest_snapshot

    try:
        df = load_latest_snapshot(settings)
        log.info("loaded training data from parquet snapshot (rows=%d)", df.height)
    except FileNotFoundError:
        log.info("no parquet snapshot found; reading directly from Supabase")
        client = get_supabase_client(settings)
        cols = ["address", LABEL_COLUMN, *FEATURE_COLUMNS]
        res = (
            client.table("training_dataset")
            .select(",".join(cols))
            .eq("featureSetVersion", settings.feature_set_version)
            .execute()
        )
        df = pl.from_dicts(res.data, infer_schema_length=None) if res.data else pl.DataFrame()

    if df.is_empty():
        raise RuntimeError(
            f"No rows for featureSetVersion={settings.feature_set_version!r}"
        )
    missing = [c for c in [LABEL_COLUMN, *FEATURE_COLUMNS] if c not in df.columns]
    if missing:
        raise RuntimeError(f"Snapshot is missing required columns: {missing}")
    return df


def _build_pipeline(scale_pos_weight: float) -> Pipeline:
    base = XGBClassifier(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        scale_pos_weight=scale_pos_weight,
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        n_jobs=-1,
    )
    # Median imputation for legitimate NaNs (e.g. wallet has no Aave history).
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("xgb", base),
        ]
    )


def train(settings: Settings | None = None) -> TrainingResult:
    settings = settings or get_settings()

    df = _load_dataframe(settings)
    n_risky = int(df.select(pl.col(LABEL_COLUMN).cast(pl.Int8).sum()).item())
    log.info(
        "loaded %d rows | risky=%d safe=%d",
        df.height, n_risky, df.height - n_risky,
    )

    # Drop into numpy for sklearn (it doesn't accept polars natively).
    x = df.select(FEATURE_COLUMNS).cast(pl.Float64).to_numpy()
    y = df.get_column(LABEL_COLUMN).cast(pl.Int8).to_numpy()

    # Stratified splits require both classes to be present with enough samples
    # to survive two successive splits (train/test then train/val). With the
    # default 0.2 test ratios that means each class needs >=4 rows in the
    # original dataset so the smallest resulting fold still has >=1 sample.
    # Fail loudly with a fix-it message instead of letting sklearn raise a
    # cryptic ValueError.
    classes, counts = np.unique(y, return_counts=True)
    class_counts = dict(zip(classes.tolist(), counts.tolist(), strict=True))
    risky_n = class_counts.get(1, 0)
    safe_n = class_counts.get(0, 0)
    min_per_class = 4
    if risky_n < min_per_class or safe_n < min_per_class:
        raise RuntimeError(
            "Training data does not contain both classes with enough samples "
            f"for stratified splitting (risky={risky_n}, safe={safe_n}, "
            f"need >= {min_per_class} of each).\n"
            "Re-run the ETL with larger targets, e.g.:\n"
            "  vouch-ml-training build-dataset --risky-target 500 --safe-target 500\n"
            "or check that extract_aave is returning both liquidated and "
            "safe-borrower wallets for the current chain."
        )

    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, stratify=y, random_state=42,
    )
    x_train, x_val, y_train, y_val = train_test_split(
        x_train, y_train, test_size=0.2, stratify=y_train, random_state=42,
    )

    n_pos = int(y_train.sum())
    n_neg = len(y_train) - n_pos
    scale_pos_weight = (n_neg / n_pos) if n_pos > 0 else 1.0
    pipe = _build_pipeline(scale_pos_weight)

    pipe.fit(x_train, y_train)

    # Isotonic calibration on the validation set so probabilities are usable
    # as a credit-score input rather than just a ranking.
    calibrated = CalibratedClassifierCV(pipe, method="isotonic", cv="prefit")
    calibrated.fit(x_val, y_val)

    p_test = calibrated.predict_proba(x_test)[:, 1]
    metrics = {
        "auc": float(roc_auc_score(y_test, p_test)),
        "pr_auc": float(average_precision_score(y_test, p_test)),
        "log_loss": float(log_loss(y_test, p_test)),
        "brier": float(brier_score_loss(y_test, p_test)),
        "positive_rate": float(np.mean(y_test)),
    }
    log.info("test metrics | %s", metrics)

    # Persist artifact
    model_version = f"{settings.feature_set_version}-{datetime.now(tz=UTC):%Y%m%dT%H%M%SZ}"
    artifact_dir = _ARTIFACT_ROOT / model_version
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(calibrated, artifact_dir / "model.joblib")

    metadata: dict[str, Any] = {
        "model_version": model_version,
        "feature_set_version": settings.feature_set_version,
        "feature_columns": FEATURE_COLUMNS,
        "label_column": LABEL_COLUMN,
        "metrics": metrics,
        "n_train": len(x_train),
        "n_val": len(x_val),
        "n_test": len(x_test),
        "trained_at": datetime.now(tz=UTC).isoformat(),
    }
    (artifact_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

    log.info("artifact written to %s", artifact_dir)
    return TrainingResult(
        model_version=model_version,
        artifact_dir=artifact_dir,
        metrics=metrics,
        n_train=len(x_train),
        n_val=len(x_val),
        n_test=len(x_test),
    )


def main() -> None:
    train()


if __name__ == "__main__":
    main()
