# apps/ml-engine/tests/test_features.py
from src.features import _compute_repay_ratio


def test_repay_ratio_basic() -> None:
    assert _compute_repay_ratio(3, 4) == 0.75


def test_repay_ratio_capped() -> None:
    assert _compute_repay_ratio(10, 4) == 1.0


def test_repay_ratio_zero_borrows() -> None:
    assert _compute_repay_ratio(0, 0) is None


def test_repay_ratio_zero_repays() -> None:
    assert _compute_repay_ratio(0, 5) == 0.0
