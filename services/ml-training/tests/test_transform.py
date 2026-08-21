"""Tests for the transform stage."""

from __future__ import annotations

from datetime import UTC, datetime

from vouch_ml_training.config import Settings
from vouch_ml_training.data.transform import build_training_rows
from vouch_ml_training.data.types import (
    LiquidationAggregate,
    SafeBorrower,
    WalletEnrichment,
)


def _settings() -> Settings:
    return Settings(
        TARGET_CHAIN_ID=1,
        FEATURE_SET_VERSION="cold_start_v1",
    )


def test_build_training_rows_assigns_labels() -> None:
    settings = _settings()
    snap = datetime(2026, 5, 20, tzinfo=UTC)

    risky = [
        LiquidationAggregate(
            address="0xaaa",
            liquidation_count=2,
            first_liquidation_at=datetime(2026, 5, 1, tzinfo=UTC),
            last_liquidation_at=datetime(2026, 5, 10, tzinfo=UTC),
            total_principal_usd=10_000.0,
        )
    ]
    safe = [
        SafeBorrower(
            address="0xbbb",
            borrows_count=4,
            total_borrowed_usd=20_000.0,
            first_borrow_at=datetime(2026, 1, 1, tzinfo=UTC),
            last_borrow_at=datetime(2026, 5, 10, tzinfo=UTC),
        )
    ]
    enrichments = {
        "0xaaa": WalletEnrichment(
            address="0xaaa", wallet_age_days=900, total_transactions=300, eth_balance=1.5,
        ),
        "0xbbb": WalletEnrichment(
            address="0xbbb", wallet_age_days=1200, total_transactions=500, eth_balance=8.0,
        ),
    }

    rows = build_training_rows(settings, snap, risky, safe, enrichments, observation_window_days=90)

    assert len(rows) == 2
    risky_row = next(r for r in rows if r.address == "0xaaa")
    safe_row = next(r for r in rows if r.address == "0xbbb")
    assert risky_row.label_is_risky is True
    assert risky_row.historical_liquidation_count == 2
    assert safe_row.label_is_risky is False
    assert safe_row.historical_liquidation_count == 0
    assert safe_row.aave_borrows_count == 4


def test_observation_window_excludes_stale_liquidations() -> None:
    """Wallets liquidated long before the snapshot should be excluded."""
    settings = _settings()
    snap = datetime(2026, 5, 20, tzinfo=UTC)

    # Liquidated 200 days before snapshot — features no longer relevant
    stale_risky = [
        LiquidationAggregate(
            address="0xccc",
            liquidation_count=1,
            first_liquidation_at=datetime(2025, 11, 1, tzinfo=UTC),
            last_liquidation_at=datetime(2025, 11, 1, tzinfo=UTC),
            total_principal_usd=5000.0,
        )
    ]
    enrichments = {"0xccc": WalletEnrichment(address="0xccc")}

    rows = build_training_rows(settings, snap, stale_risky, [], enrichments, observation_window_days=90)
    assert len(rows) == 0


def test_observation_window_excludes_recent_safe_borrowers() -> None:
    """Safe wallets that haven't had enough time to prove safety are excluded."""
    settings = _settings()
    snap = datetime(2026, 5, 20, tzinfo=UTC)

    # First borrowed only 30 days ago — hasn't had full observation window
    recent_safe = [
        SafeBorrower(
            address="0xddd",
            borrows_count=2,
            total_borrowed_usd=1000.0,
            first_borrow_at=datetime(2026, 4, 25, tzinfo=UTC),
            last_borrow_at=datetime(2026, 5, 10, tzinfo=UTC),
        )
    ]
    enrichments = {"0xddd": WalletEnrichment(address="0xddd")}

    rows = build_training_rows(settings, snap, [], recent_safe, enrichments, observation_window_days=90)
    assert len(rows) == 0


def test_new_aave_fields_present_on_training_rows() -> None:
    """TrainingRow carries aave_repay_ratio from source records."""
    settings = _settings()
    snap = datetime(2026, 5, 20, tzinfo=UTC)

    risky = [
        LiquidationAggregate(
            address="0xaaa",
            liquidation_count=2,
            first_liquidation_at=datetime(2026, 5, 1, tzinfo=UTC),
            last_liquidation_at=datetime(2026, 5, 10, tzinfo=UTC),
            total_principal_usd=10_000.0,
            aave_repay_ratio=0.8,
        )
    ]
    safe = [
        SafeBorrower(
            address="0xbbb",
            borrows_count=4,
            total_borrowed_usd=20_000.0,
            first_borrow_at=datetime(2026, 1, 1, tzinfo=UTC),
            last_borrow_at=datetime(2026, 5, 10, tzinfo=UTC),
            aave_repay_ratio=0.75,
        )
    ]
    enrichments = {
        "0xaaa": WalletEnrichment(address="0xaaa"),
        "0xbbb": WalletEnrichment(address="0xbbb"),
    }

    rows = build_training_rows(settings, snap, risky, safe, enrichments, observation_window_days=90)

    risky_row = next(r for r in rows if r.address == "0xaaa")
    safe_row = next(r for r in rows if r.address == "0xbbb")

    assert risky_row.aave_repay_ratio == 0.8
    assert safe_row.aave_repay_ratio == 0.75
