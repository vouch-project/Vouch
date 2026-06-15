"""Tests for the credit scorer module."""
import pytest
from fastapi.testclient import TestClient

from main import app
from src.scorer import (
    CreditScorer,
    ScoringResult,
    _compute_credit_score,
    _generate_signals,
)

client = TestClient(app)


@pytest.mark.anyio
async def test_scorer_returns_stub_when_no_model() -> None:
    scorer = CreditScorer()
    result = await scorer.score("0x1234567890abcdef1234567890abcdef12345678")
    assert isinstance(result, ScoringResult)
    assert result.score == 0
    assert result.confidence == 0.0
    assert result.strengths == []
    assert result.risk_factors == []
    assert result.improvements == []
    assert result.model_version == "none"


def test_scorer_is_not_ready_when_no_model() -> None:
    scorer = CreditScorer()
    assert scorer.is_ready() is False


def test_score_endpoint_returns_503_when_no_model() -> None:
    response = client.get("/api/v1/score/0x1234567890abcdef1234567890abcdef12345678")
    assert response.status_code == 503
    assert response.json()["detail"] == "Model not loaded — run training pipeline first."


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_credit_score_zero_age() -> None:
    score, _ = _compute_credit_score(risk_probability=0.1, wallet_age_days=0)
    assert score == 300


def test_credit_score_full_age_low_risk() -> None:
    # confidence=1.0, risk=0.05 → 300 + round(0.95*550*1.0) = 300 + 522 = 822
    score, confidence = _compute_credit_score(risk_probability=0.05, wallet_age_days=365)
    assert score == 822
    assert confidence == 1.0


def test_credit_score_full_age_full_risk() -> None:
    # risk=1.0 → additive=0 → 300
    score, _ = _compute_credit_score(risk_probability=1.0, wallet_age_days=365)
    assert score == 300


def test_credit_score_half_age() -> None:
    score, _ = _compute_credit_score(risk_probability=0.0, wallet_age_days=182)
    assert 570 <= score <= 578


def test_credit_score_none_age_uses_zero() -> None:
    score, confidence = _compute_credit_score(risk_probability=0.0, wallet_age_days=None)
    assert score == 300
    assert confidence == 0.0


def test_score_in_fico_range() -> None:
    for risk in [0.0, 0.5, 1.0]:
        for age in [0, 180, 365, 730]:
            s, _ = _compute_credit_score(risk, age)
            assert 300 <= s <= 850, f"score={s} out of FICO range for risk={risk} age={age}"


def test_signals_very_new_wallet() -> None:
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=30,
        total_transactions=5,
        unique_protocols_interacted=1,
        aave_repay_ratio=None,
        aave_days_since_last_borrow=None,
        aave_borrows_count=0,
        eth_balance=1.0,
        stablecoin_balance_usd=0.0,
    )
    assert any("Very new wallet" in f for f in risk_factors)
    assert any("history grows" in i for i in improvements)


def test_signals_no_defi_history() -> None:
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=400,
        total_transactions=50,
        unique_protocols_interacted=1,
        aave_repay_ratio=None,
        aave_days_since_last_borrow=None,
        aave_borrows_count=0,
        eth_balance=1.0,
        stablecoin_balance_usd=0.0,
    )
    assert any("No DeFi borrowing" in f for f in risk_factors)


def test_signals_low_repay_ratio() -> None:
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=400,
        total_transactions=50,
        unique_protocols_interacted=3,
        aave_repay_ratio=0.3,
        aave_days_since_last_borrow=5,
        aave_borrows_count=5,
        eth_balance=1.0,
        stablecoin_balance_usd=0.0,
    )
    assert any("repayment ratio" in f for f in risk_factors)
    assert any("repayment rate" in i for i in improvements)


def test_signals_healthy_wallet_has_strengths() -> None:
    strengths, risk_factors, improvements = _generate_signals(
        wallet_age_days=730,
        total_transactions=200,
        unique_protocols_interacted=8,
        aave_repay_ratio=0.9,
        aave_days_since_last_borrow=10,
        aave_borrows_count=10,
        eth_balance=2.0,
        stablecoin_balance_usd=1000.0,
    )
    assert len(strengths) >= 3
    assert risk_factors == []
    assert improvements == []


def test_signals_high_repay_ratio_is_strength() -> None:
    strengths, _, _ = _generate_signals(
        wallet_age_days=730,
        total_transactions=200,
        unique_protocols_interacted=8,
        aave_repay_ratio=0.85,
        aave_days_since_last_borrow=10,
        aave_borrows_count=10,
        eth_balance=2.0,
        stablecoin_balance_usd=0.0,
    )
    assert any("repayment" in s for s in strengths)
