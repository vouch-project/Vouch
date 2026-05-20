"""Combine subgraph aggregates + wallet enrichment into TrainingRow records."""

from __future__ import annotations

from datetime import UTC, datetime

from vouch_ml_training.config import Settings
from vouch_ml_training.data.types import (
    LiquidationAggregate,
    SafeBorrower,
    TrainingRow,
    WalletEnrichment,
)


def build_training_rows(
    settings: Settings,
    snapshot_at: datetime | None,
    liquidations: list[LiquidationAggregate],
    safe_borrowers: list[SafeBorrower],
    enrichments: dict[str, WalletEnrichment],
) -> list[TrainingRow]:
    """Merge label sources + enrichment into the final training-row schema."""
    snap = snapshot_at or datetime.now(tz=UTC)
    rows: list[TrainingRow] = []

    for liq in liquidations:
        enr = enrichments.get(liq.address, WalletEnrichment(address=liq.address))
        rows.append(
            TrainingRow(
                address=liq.address,
                chain_id=settings.target_chain_id,
                label_is_risky=True,
                label_source="aave_v3_liquidation",
                snapshot_at=snap,
                wallet_age_days=enr.wallet_age_days,
                total_transactions=enr.total_transactions,
                historical_liquidation_count=liq.liquidation_count,
                aave_borrows_count=None,
                aave_total_borrowed_usd=liq.total_principal_usd,
                eth_balance=enr.eth_balance,
                stablecoin_balance_usd=enr.stablecoin_balance_usd,
                unique_protocols_interacted=enr.unique_protocols_interacted,
                raw_features={
                    "first_liquidation_at": liq.first_liquidation_at.isoformat(),
                    "last_liquidation_at": liq.last_liquidation_at.isoformat(),
                },
                feature_set_version=settings.feature_set_version,
            )
        )

    for safe in safe_borrowers:
        enr = enrichments.get(safe.address, WalletEnrichment(address=safe.address))
        rows.append(
            TrainingRow(
                address=safe.address,
                chain_id=settings.target_chain_id,
                label_is_risky=False,
                label_source="aave_v3_safe_borrower",
                snapshot_at=snap,
                wallet_age_days=enr.wallet_age_days,
                total_transactions=enr.total_transactions,
                historical_liquidation_count=0,
                aave_borrows_count=safe.borrows_count,
                aave_total_borrowed_usd=safe.total_borrowed_usd,
                eth_balance=enr.eth_balance,
                stablecoin_balance_usd=enr.stablecoin_balance_usd,
                unique_protocols_interacted=enr.unique_protocols_interacted,
                raw_features={
                    "last_borrow_at": (
                        safe.last_borrow_at.isoformat() if safe.last_borrow_at else None
                    ),
                },
                feature_set_version=settings.feature_set_version,
            )
        )

    return rows
