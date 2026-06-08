"""Smoke test for the XGBoost training pipeline on synthetic data."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import numpy as np
import polars as pl
import pytest

from vouch_ml_training.config import Settings
from vouch_ml_training.pipelines.train_xgboost import FEATURE_COLUMNS, LABEL_COLUMN, train


def _make_synthetic_df(n: int = 200, seed: int = 42) -> pl.DataFrame:
    """Generate synthetic data where risky/safe wallets have distinct patterns."""
    rng = np.random.default_rng(seed)
    n_risky = n // 2
    n_safe = n - n_risky

    def _block(is_risky: bool, count: int) -> dict[str, list]:
        if is_risky:
            return {
                "walletAgeDays": rng.integers(10, 200, size=count).tolist(),
                "totalTransactions": rng.integers(1, 50, size=count).tolist(),
                "aaveBorrowsCount": rng.integers(1, 5, size=count).tolist(),
                "aaveTotalBorrowedUsd": (rng.random(count) * 5000).tolist(),
                "ethBalance": (rng.random(count) * 2).tolist(),
                "stablecoinBalanceUsd": (rng.random(count) * 500).tolist(),
                "uniqueProtocolsInteracted": rng.integers(1, 5, size=count).tolist(),
                "aaveDaysSinceLastBorrow": rng.integers(1, 30, size=count).tolist(),
                "aaveAvgHealthFactorAtBorrow": [float("nan")] * count,
                "aaveRepayRatio": (rng.random(count) * 0.5).tolist(),
                LABEL_COLUMN: [True] * count,
            }
        return {
            "walletAgeDays": rng.integers(500, 2000, size=count).tolist(),
            "totalTransactions": rng.integers(100, 5000, size=count).tolist(),
            "aaveBorrowsCount": rng.integers(5, 50, size=count).tolist(),
            "aaveTotalBorrowedUsd": (rng.random(count) * 50000 + 5000).tolist(),
            "ethBalance": (rng.random(count) * 50 + 2).tolist(),
            "stablecoinBalanceUsd": (rng.random(count) * 50000 + 1000).tolist(),
            "uniqueProtocolsInteracted": rng.integers(5, 30, size=count).tolist(),
            "aaveDaysSinceLastBorrow": rng.integers(90, 365, size=count).tolist(),
            "aaveAvgHealthFactorAtBorrow": (rng.random(count) * 0.5 + 1.5).tolist(),
            "aaveRepayRatio": (rng.random(count) * 0.3 + 0.7).tolist(),
            LABEL_COLUMN: [False] * count,
        }

    risky = _block(True, n_risky)
    safe = _block(False, n_safe)
    merged = {k: risky[k] + safe[k] for k in risky}
    merged["address"] = [f"0x{i:040x}" for i in range(n)]
    return pl.DataFrame(merged)


def _settings() -> Settings:
    return Settings(
        FEATURE_SET_VERSION="test_v1",
        TARGET_CHAIN_ID=1,
    )


def test_train_produces_model_better_than_random(tmp_path: Path) -> None:
    """Train on synthetic data and verify the model beats random chance."""
    df = _make_synthetic_df(n=200)

    with patch(
        "vouch_ml_training.pipelines.train_xgboost._load_dataframe",
        return_value=df,
    ), patch(
        "vouch_ml_training.pipelines.train_xgboost._ARTIFACT_ROOT",
        tmp_path,
    ):
        result = train(settings=_settings())

    assert result.artifact_dir.exists()
    assert (result.artifact_dir / "model.joblib").exists()
    assert (result.artifact_dir / "metadata.json").exists()
    assert result.metrics["auc"] > 0.7
    assert result.metrics["accuracy"] > 0.6
    assert 0.0 <= result.metrics["brier"] <= 1.0
    assert result.n_train > 0


def test_train_fails_on_insufficient_data(tmp_path: Path) -> None:
    """Verify a clear error when dataset is too small for stratified splits."""
    df = pl.DataFrame({
        "walletAgeDays": [100, 200, 300, 400, 500],
        "totalTransactions": [10, 20, 30, 40, 50],
        "aaveBorrowsCount": [1, 2, 3, 4, 5],
        "aaveTotalBorrowedUsd": [1000.0, 2000.0, 3000.0, 4000.0, 5000.0],
        "ethBalance": [1.0, 2.0, 3.0, 4.0, 5.0],
        "stablecoinBalanceUsd": [100.0, 200.0, 300.0, 400.0, 500.0],
        "uniqueProtocolsInteracted": [2, 3, 4, 5, 6],
        "aaveDaysSinceLastBorrow": [10, 20, 90, 100, 120],
        "aaveAvgHealthFactorAtBorrow": [float("nan"), float("nan"), 1.5, 1.6, 1.7],
        "aaveRepayRatio": [0.1, 0.2, 0.8, 0.85, 0.9],
        LABEL_COLUMN: [True, True, False, False, False],
        "address": ["0x01", "0x02", "0x03", "0x04", "0x05"],
    })

    with patch(
        "vouch_ml_training.pipelines.train_xgboost._load_dataframe",
        return_value=df,
    ), patch(
        "vouch_ml_training.pipelines.train_xgboost._ARTIFACT_ROOT",
        tmp_path,
    ):
        with pytest.raises(RuntimeError, match="enough samples"):
            train(settings=_settings())
