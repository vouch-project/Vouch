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
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from vouch_ml_training.config import Settings, get_settings
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
    from vouch_ml_training.data.parquet_io import fetch_all_rows, load_latest_snapshot

    try:
        df = load_latest_snapshot(settings)
        log.info("loaded training data from parquet snapshot (rows=%d)", df.height)
    except FileNotFoundError:
        # Fall back to a live Supabase read so the trainer still works on a
        # fresh setup. Use the paginated fetcher from parquet_io: PostgREST
        # caps responses at 1000 rows, so a single `.select().execute()`
        # would silently truncate datasets larger than that (the default
        # ETL targets are 750 risky + 750 safe = 1500 rows).
        log.info("no parquet snapshot found; reading directly from Supabase (paginated)")
        df = fetch_all_rows(settings)
        if not df.is_empty():
            keep = [c for c in ["address", LABEL_COLUMN, *FEATURE_COLUMNS] if c in df.columns]
            df = df.select(keep)

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
            "  vouch-ml-training build-dataset --risky 500 --safe 500\n"
            "or check that extract_aave is returning both liquidated and "
            "safe-borrower wallets for the current chain."
        )

    # 5-fold stratified cross-validation for reliable evaluation.
    kf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    fold_metrics: list[dict[str, float]] = []

    for fold_idx, (train_idx, test_idx) in enumerate(kf.split(x, y)):
        x_fold_train, x_fold_test = x[train_idx], x[test_idx]
        y_fold_train, y_fold_test = y[train_idx], y[test_idx]

        n_pos = int(y_fold_train.sum())
        n_neg = len(y_fold_train) - n_pos
        spw = (n_neg / n_pos) if n_pos > 0 else 1.0
        fold_pipe = _build_pipeline(spw)
        fold_pipe.fit(x_fold_train, y_fold_train)

        p_fold = fold_pipe.predict_proba(x_fold_test)[:, 1]
        y_fold_pred = (p_fold >= 0.5).astype(int)
        fold_metrics.append({
            "accuracy": float(accuracy_score(y_fold_test, y_fold_pred)),
            "auc": float(roc_auc_score(y_fold_test, p_fold)),
            "pr_auc": float(average_precision_score(y_fold_test, p_fold)),
            "log_loss": float(log_loss(y_fold_test, p_fold)),
            "brier": float(brier_score_loss(y_fold_test, p_fold)),
        })
        log.info("fold %d metrics | %s", fold_idx + 1, fold_metrics[-1])

    # Average metrics across folds
    metrics: dict[str, float] = {}
    for key in fold_metrics[0]:
        values = [m[key] for m in fold_metrics]
        metrics[key] = float(np.mean(values))
        metrics[f"{key}_std"] = float(np.std(values))
    metrics["positive_rate"] = float(np.mean(y))
    log.info("cv metrics (mean) | %s", {k: v for k, v in metrics.items() if not k.endswith("_std")})

    # Train final production model on all data
    n_pos = int(y.sum())
    n_neg = len(y) - n_pos
    scale_pos_weight = (n_neg / n_pos) if n_pos > 0 else 1.0
    pipe = _build_pipeline(scale_pos_weight)
    pipe.fit(x, y)

    # Calibrate on a held-out portion for probability quality.
    # sklearn >=1.8 removed cv="prefit"; use IsotonicRegression directly.
    x_cal_train, x_cal_val, y_cal_train, y_cal_val = train_test_split(
        x, y, test_size=0.2, stratify=y, random_state=42,
    )
    cal_pipe = _build_pipeline(scale_pos_weight)
    cal_pipe.fit(x_cal_train, y_cal_train)
    raw_proba_val = cal_pipe.predict_proba(x_cal_val)[:, 1]
    isotonic = IsotonicRegression(out_of_bounds="clip")
    isotonic.fit(raw_proba_val, y_cal_val)

    # Persist artifact
    model_version = f"{settings.feature_set_version}-{datetime.now(tz=UTC):%Y%m%dT%H%M%SZ}"
    artifact_dir = _ARTIFACT_ROOT / model_version
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": cal_pipe, "calibrator": isotonic}, artifact_dir / "model.joblib")

    metadata: dict[str, Any] = {
        "model_version": model_version,
        "feature_set_version": settings.feature_set_version,
        "feature_columns": FEATURE_COLUMNS,
        "label_column": LABEL_COLUMN,
        "metrics": metrics,
        "cv_folds": len(fold_metrics),
        "n_total": len(x),
        "trained_at": datetime.now(tz=UTC).isoformat(),
    }
    (artifact_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

    log.info("artifact written to %s", artifact_dir)
    return TrainingResult(
        model_version=model_version,
        artifact_dir=artifact_dir,
        metrics=metrics,
        n_train=len(x),
        n_val=0,
        n_test=0,
    )


def main() -> None:
    train()


if __name__ == "__main__":
    main()
