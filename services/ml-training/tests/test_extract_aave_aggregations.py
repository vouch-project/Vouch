"""Unit tests for aave extraction aggregation helpers (no network calls)."""

from __future__ import annotations

from vouch_ml_training.data.extract_aave import _compute_repay_ratio


def test_repay_ratio_basic() -> None:
    assert _compute_repay_ratio(repay_count=3, borrow_count=4) == 0.75


def test_repay_ratio_capped_at_one() -> None:
    assert _compute_repay_ratio(repay_count=10, borrow_count=4) == 1.0


def test_repay_ratio_zero_borrows_returns_none() -> None:
    assert _compute_repay_ratio(repay_count=0, borrow_count=0) is None


def test_repay_ratio_zero_repays() -> None:
    assert _compute_repay_ratio(repay_count=0, borrow_count=5) == 0.0
