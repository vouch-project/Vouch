"""Tests for the credit scorer module."""
from fastapi.testclient import TestClient
from main import app
from src.scorer import CreditScorer, ScoringResult

client = TestClient(app)


def test_scorer_returns_stub_when_no_model() -> None:
    scorer = CreditScorer()
    result = scorer.score("0x1234567890abcdef1234567890abcdef12345678")
    assert isinstance(result, ScoringResult)
    assert result.score == 0
    assert result.confidence == 0.0
    assert result.risk_level == "very_high"
    assert result.factors == []
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
