"""Load TrainingRow records into Supabase via supabase-py.

We use the service role key to bypass RLS. The unique constraint on
(address, chainId, featureSetVersion) lets us upsert idempotently, so the
ETL is safe to re-run incrementally.
"""

from __future__ import annotations

from typing import Any

from supabase import Client, create_client

from vouch_ml_training.config import Settings
from vouch_ml_training.data.types import TrainingRow
from vouch_ml_training.logging import get_logger

log = get_logger(__name__)

_TABLE = "training_dataset"
_BATCH_SIZE = 500


def get_supabase_client(settings: Settings) -> Client:
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")
    return create_client(settings.supabase_url, settings.supabase_secret_key)


def _row_to_db(row: TrainingRow) -> dict[str, Any]:
    """Map our snake_case Pydantic model to the table's quoted camelCase columns."""
    return {
        "address": row.address.lower(),
        "chainId": row.chain_id,
        "labelIsRisky": row.label_is_risky,
        "labelSource": row.label_source,
        "snapshotAt": row.snapshot_at.isoformat(),
        "walletAgeDays": row.wallet_age_days,
        "totalTransactions": row.total_transactions,
        "historicalLiquidationCount": row.historical_liquidation_count,
        "aaveBorrowsCount": row.aave_borrows_count,
        "aaveTotalBorrowedUsd": row.aave_total_borrowed_usd,
        "ethBalance": row.eth_balance,
        "stablecoinBalanceUsd": row.stablecoin_balance_usd,
        "uniqueProtocolsInteracted": row.unique_protocols_interacted,
        "aaveDaysSinceLastBorrow": row.aave_days_since_last_borrow,
        "aaveAvgHealthFactorAtBorrow": row.aave_avg_health_factor_at_borrow,
        "aaveRepayRatio": row.aave_repay_ratio,
        "rawFeatures": row.raw_features,
        "featureSetVersion": row.feature_set_version,
    }


def upsert_training_rows(settings: Settings, rows: list[TrainingRow]) -> int:
    """Upsert rows into `training_dataset`. Returns the number of rows upserted."""
    if not rows:
        return 0
    client = get_supabase_client(settings)

    total = 0
    for i in range(0, len(rows), _BATCH_SIZE):
        batch = rows[i : i + _BATCH_SIZE]
        payload = [_row_to_db(r) for r in batch]
        # `on_conflict` uses the unique constraint we declared in the migration.
        client.table(_TABLE).upsert(
            payload,
            on_conflict="address,chainId,featureSetVersion",
        ).execute()
        total += len(batch)
        log.info("upserted batch %d-%d (total=%d)", i, i + len(batch), total)
    return total
