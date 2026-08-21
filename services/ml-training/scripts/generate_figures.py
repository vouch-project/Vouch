"""Generate diagnostic figures for the Vouch Credit Engine model artifact.

Run from services/ml-training/:
    python scripts/generate_figures.py

Produces four PNG figures saved to Desktop:
    fig_feature_importance.png
    fig_roc_curve.png
    fig_calibration_curve.png
    fig_score_distribution.png
"""

from __future__ import annotations

from pathlib import Path

import joblib
import matplotlib
import numpy as np
import polars as pl

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.calibration import calibration_curve
from sklearn.metrics import roc_auc_score, roc_curve
from sklearn.model_selection import train_test_split

from vouch_ml_training.config import get_settings
from vouch_ml_training.data.parquet_io import load_latest_snapshot
from vouch_ml_training.pipelines.train_xgboost import FEATURE_COLUMNS, LABEL_COLUMN

OUTPUT_DIR = Path.cwd()

# Colour palette (dark terminal aesthetic matching the project screenshots)
C_SAFE = "#4fc3f7"
C_RISKY = "#ef5350"
C_ACCENT = "#ffb300"
C_DIAG = "#616161"
BG = "#1e1e2e"
FG = "#cdd6f4"
GRID = "#313244"


def _dark_style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": BG,
            "axes.facecolor": BG,
            "axes.edgecolor": GRID,
            "axes.labelcolor": FG,
            "text.color": FG,
            "xtick.color": FG,
            "ytick.color": FG,
            "grid.color": GRID,
            "legend.facecolor": "#2a2a3e",
            "legend.edgecolor": GRID,
            "font.size": 11,
        }
    )


def _load(settings) -> tuple:
    artifact_root = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "vouch_ml_training"
        / "models"
        / "artifacts"
    )
    latest = sorted(artifact_root.iterdir())[-1]
    model = joblib.load(latest / "model.joblib")

    df = load_latest_snapshot(settings)
    X = df.select(FEATURE_COLUMNS).cast(pl.Float64).to_numpy()
    y = df.get_column(LABEL_COLUMN).cast(pl.Int8).to_numpy()

    # Reproduce the 80/20 holdout used during training (same seed) so ROC and
    # calibration curves are evaluated on data the model never trained on.
    _, X_val, _, y_val = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    print(f"model  : {latest.name}")
    print(f"dataset: {len(X)} total | val={len(X_val)} ({y_val.sum()} risky, {(y_val==0).sum()} safe)")
    return model, X, y, X_val, y_val


def fig_feature_importance(model, output_dir: Path) -> None:
    xgb = model._pipeline.named_steps["xgb"]
    imp = xgb.feature_importances_
    order = np.argsort(imp)
    names = [FEATURE_COLUMNS[i] for i in order]
    vals = imp[order]

    fig, ax = plt.subplots(figsize=(9, 5))
    bars = ax.barh(names, vals, color=C_SAFE, alpha=0.85)
    for bar, v in zip(bars, vals):
        ax.text(v + 0.003, bar.get_y() + bar.get_height() / 2,
                f"{v:.3f}", va="center", fontsize=9, color=FG)
    ax.set_xlabel("Feature importance (gain)")
    ax.set_title("XGBoost Feature Importance — Vouch Credit Engine")
    ax.set_xlim(0, max(vals) * 1.18)
    ax.grid(axis="x", alpha=0.35)
    fig.tight_layout()
    _save(fig, output_dir / "fig_feature_importance.png")


def fig_roc_curve(model, X_val: np.ndarray, y_val: np.ndarray, output_dir: Path) -> None:
    proba = model.predict_proba(X_val)[:, 1]
    fpr, tpr, _ = roc_curve(y_val, proba)
    auc = roc_auc_score(y_val, proba)

    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot(fpr, tpr, color=C_SAFE, lw=2, label=f"ROC curve  (AUC = {auc:.4f})")
    ax.plot([0, 1], [0, 1], "--", color=C_DIAG, lw=1.2, label="Random classifier")
    ax.fill_between(fpr, tpr, alpha=0.08, color=C_SAFE)
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_title("ROC Curve — Vouch Credit Engine")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    _save(fig, output_dir / "fig_roc_curve.png")


def fig_calibration_curve(model, X_val: np.ndarray, y_val: np.ndarray, output_dir: Path) -> None:
    raw_proba = model._pipeline.predict_proba(X_val)[:, 1]
    cal_proba = model.predict_proba(X_val)[:, 1]

    frac_raw, mean_raw = calibration_curve(y_val, raw_proba, n_bins=10, strategy="quantile")
    frac_cal, mean_cal = calibration_curve(y_val, cal_proba, n_bins=10, strategy="quantile")

    fig, ax = plt.subplots(figsize=(7, 6))
    ax.plot([0, 1], [0, 1], "--", color=C_DIAG, lw=1.2, label="Perfect calibration")
    ax.plot(mean_raw, frac_raw, "o-", color=C_RISKY, lw=2, label="Raw XGBoost (uncalibrated)")
    ax.plot(mean_cal, frac_cal, "s-", color=C_SAFE, lw=2, label="After Platt scaling")
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Fraction of positives")
    ax.set_title("Calibration Curve — Before and After Platt Scaling")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    _save(fig, output_dir / "fig_calibration_curve.png")


def fig_score_distribution(model, X: np.ndarray, y: np.ndarray, output_dir: Path) -> None:
    proba = model.predict_proba(X)[:, 1]
    age_idx = FEATURE_COLUMNS.index("walletAgeDays")
    ages = X[:, age_idx]
    cw = np.where(np.isnan(ages), 0.0, np.minimum(1.0, ages / 365))
    scores = 300 + np.round((1 - proba) * 550 * cw).astype(int)

    safe_scores = scores[y == 0]
    risky_scores = scores[y == 1]

    bins = np.arange(295, 860, 20)
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.hist(safe_scores, bins=bins, color=C_SAFE, alpha=0.75, label=f"Safe  (n={len(safe_scores)})")
    ax.hist(risky_scores, bins=bins, color=C_RISKY, alpha=0.75, label=f"Risky (n={len(risky_scores)})")
    ax.set_xlabel("Credit score (300–850)")
    ax.set_ylabel("Number of wallets")
    ax.set_title("Credit Score Distribution — Safe vs Risky Wallets")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    ax.set_xlim(280, 860)
    fig.tight_layout()
    _save(fig, output_dir / "fig_score_distribution.png")


def _save(fig: plt.Figure, path: Path) -> None:
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"saved → {path}")


def main() -> None:
    _dark_style()
    settings = get_settings()
    model, X, y, X_val, y_val = _load(settings)

    fig_feature_importance(model, OUTPUT_DIR)
    fig_roc_curve(model, X_val, y_val, OUTPUT_DIR)
    fig_calibration_curve(model, X_val, y_val, OUTPUT_DIR)
    fig_score_distribution(model, X, y, OUTPUT_DIR)

    print("\ndone. figures saved to", OUTPUT_DIR)


if __name__ == "__main__":
    main()
