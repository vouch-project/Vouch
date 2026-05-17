"""Tests for the credit scorer module."""
import pytest
from src.scorer import CreditScorer, ScoringResult


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
