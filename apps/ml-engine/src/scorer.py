# apps/ml-engine/src/scorer.py
"""Credit scoring logic — loads model artifact and runs inference."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from pydantic import ValidationError

from src.compat import register as _register_compat
from src.config import get_settings
from src.features import fetch_features

_register_compat()

_ARTIFACT_ROOT = (
    Path(__file__).resolve().parents[3]
    / "services"
    / "ml-training"
    / "src"
    / "vouch_ml_training"
    / "models"
    / "artifacts"
)

_FEATURE_COLUMNS = [
    "walletAgeDays",
    "totalTransactions",
    "aaveBorrowsCount",
    "aaveTotalBorrowedUsd",
    "ethBalance",
    "stablecoinBalanceUsd",
    "uniqueProtocolsInteracted",
    "aaveDaysSinceLastBorrow",
    "aaveRepayRatio",
]

BASE_SCORE = 300
MAX_ADDITIVE = 550  # 300 + 550 = 850 ceiling (FICO range)

_log = logging.getLogger(__name__)


@dataclass
class ScoringResult:
    score: int
    confidence: float
    strengths: list[str]
    risk_factors: list[str]
    improvements: list[str]
    model_version: str
    explanation: str | None = None


def _compute_credit_score(
    risk_probability: float, wallet_age_days: int | None
) -> tuple[int, float]:
    age = wallet_age_days or 0
    confidence_weight = min(1.0, age / 365.0)
    additive = (1.0 - risk_probability) * MAX_ADDITIVE
    return BASE_SCORE + round(additive * confidence_weight), confidence_weight


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

    # Strengths
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
        aave_borrows_count is not None
        and aave_borrows_count >= 3
        and aave_repay_ratio is not None
        and aave_repay_ratio >= 0.8
    ):
        strengths.append("Consistent DeFi borrowing track record")

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
        improvements.append("Increasing your Aave repayment rate will improve your score")
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
        improvements.append("Recent borrowing activity signals active protocol engagement")

    # Balance
    if eth_balance is not None and eth_balance < 0.05:
        risk_factors.append("Low ETH balance")
        improvements.append("Maintaining an ETH balance improves your score")
    if (
        stablecoin_balance_usd is not None
        and stablecoin_balance_usd < 50
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

        try:
            settings = get_settings()
        except ValidationError:
            raise  # missing/invalid env vars → fail loudly at startup

        try:
            artifact_dir = settings.artifact_path or _find_latest_artifact(_ARTIFACT_ROOT)
            self._load(artifact_dir)
        except Exception as exc:
            _log.warning("Could not load model artifact: %s", exc)

    def _load(self, artifact_dir: Path) -> None:
        metadata = json.loads((artifact_dir / "metadata.json").read_text())
        self._model = joblib.load(artifact_dir / "model.joblib")
        self._model_version = metadata["model_version"]
        self._feature_columns = metadata["feature_columns"]

    def is_ready(self) -> bool:
        return self._model is not None

    async def score(self, address: str) -> ScoringResult:
        if not self.is_ready():
            return ScoringResult(
                score=0,
                confidence=0.0,
                strengths=[],
                risk_factors=[],
                improvements=[],
                model_version=self._model_version,
            )

        features = await fetch_features(address)
        x = np.array(
            [
                [
                    float(features[col]) if features.get(col) is not None else np.nan
                    for col in self._feature_columns
                ]
            ]
        )

        risk_probability = float(self._model.predict_proba(x)[0, 1])  # type: ignore[union-attr]

        wallet_age = features.get("walletAgeDays")
        wallet_age_days = int(wallet_age) if wallet_age is not None else None
        credit_score, confidence_weight = _compute_credit_score(risk_probability, wallet_age_days)

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
