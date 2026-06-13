# apps/ml-engine/tests/test_features.py
import time

from src.features import _compute_days_since, _compute_repay_ratio


def test_days_since_returns_none_for_no_timestamp() -> None:
    assert _compute_days_since(None) is None


def test_days_since_returns_int() -> None:
    ts = int(time.time()) - 86400 * 10  # 10 days ago
    result = _compute_days_since(ts)
    assert result == 10


def test_repay_ratio_basic() -> None:
    assert _compute_repay_ratio(3, 4) == 0.75


def test_repay_ratio_capped() -> None:
    assert _compute_repay_ratio(10, 4) == 1.0


def test_repay_ratio_zero_borrows() -> None:
    assert _compute_repay_ratio(0, 0) is None


def test_repay_ratio_zero_repays() -> None:
    assert _compute_repay_ratio(0, 5) == 0.0
