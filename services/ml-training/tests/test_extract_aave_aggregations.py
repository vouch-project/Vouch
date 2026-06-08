"""Unit tests for aave extraction aggregation helpers (no network calls)."""

from __future__ import annotations

from vouch_ml_training.data.extract_aave import _compute_avg_health_factor, _compute_repay_ratio


def test_avg_health_factor_converts_ray_units() -> None:
    """healthFactor from subgraph is in ray units (1e27 = HF of 1.0)."""
    # Two borrow events: HF of 1.5 and 2.0 in ray units
    events = [
        {"healthFactor": str(int(1.5 * 1e27))},
        {"healthFactor": str(int(2.0 * 1e27))},
    ]
    result = _compute_avg_health_factor(events)
    assert result is not None
    assert abs(result - 1.75) < 1e-6


def test_avg_health_factor_returns_none_for_empty() -> None:
    assert _compute_avg_health_factor([]) is None


def test_avg_health_factor_skips_missing_field() -> None:
    """Events without healthFactor field are skipped gracefully."""
    events = [{"healthFactor": str(int(2.0 * 1e27))}, {}]
    result = _compute_avg_health_factor(events)
    assert result is not None
    assert abs(result - 2.0) < 1e-6


def test_repay_ratio_basic() -> None:
    assert _compute_repay_ratio(repay_count=3, borrow_count=4) == 0.75


def test_repay_ratio_capped_at_one() -> None:
    assert _compute_repay_ratio(repay_count=10, borrow_count=4) == 1.0


def test_repay_ratio_zero_borrows_returns_none() -> None:
    assert _compute_repay_ratio(repay_count=0, borrow_count=0) is None


def test_repay_ratio_zero_repays() -> None:
    assert _compute_repay_ratio(repay_count=0, borrow_count=5) == 0.0
