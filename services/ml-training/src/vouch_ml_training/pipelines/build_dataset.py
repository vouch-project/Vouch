"""End-to-end ETL: subgraph -> enrichment -> Supabase upsert."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from vouch_ml_training.config import Settings, get_settings
from vouch_ml_training.data.extract_aave import (
    fetch_liquidated_wallets,
    fetch_safe_borrowers,
)
from vouch_ml_training.data.extract_wallets import enrich_wallets
from vouch_ml_training.data.load import upsert_training_rows
from vouch_ml_training.data.transform import build_training_rows
from vouch_ml_training.data.types import WalletEnrichment
from vouch_ml_training.logging import get_logger

log = get_logger(__name__)


async def run_etl(settings: Settings | None = None) -> int:
    settings = settings or get_settings()
    snapshot_at = datetime.now(tz=UTC)

    log.info(
        "ETL start | risky_target=%d safe_target=%d chain_id=%d feature_set=%s",
        settings.target_risky_wallets,
        settings.target_safe_wallets,
        settings.target_chain_id,
        settings.feature_set_version,
    )

    # 1) Risky class — liquidated borrowers
    liquidations = await fetch_liquidated_wallets(settings, settings.target_risky_wallets)
    log.info("fetched %d liquidated wallets", len(liquidations))

    # 2) Safe class — borrowers never in the liquidated set
    risky_addresses = {a.address for a in liquidations}
    safe_borrowers = await fetch_safe_borrowers(
        settings, settings.target_safe_wallets, risky_addresses,
    )
    log.info("fetched %d safe borrowers", len(safe_borrowers))

    # 3) Enrichment for every wallet on both sides
    all_addresses = sorted({*risky_addresses, *(s.address for s in safe_borrowers)})
    enrichment_list = await enrich_wallets(settings, all_addresses)
    enrichments: dict[str, WalletEnrichment] = {e.address: e for e in enrichment_list}
    log.info("enriched %d wallets", len(enrichments))

    # 4) Transform to TrainingRow
    rows = build_training_rows(
        settings, snapshot_at, liquidations, safe_borrowers, enrichments,
        observation_window_days=settings.observation_window_days,
    )
    log.info("built %d training rows", len(rows))

    # 5) Load to Supabase
    written = upsert_training_rows(settings, rows)
    log.info("ETL done | rows_upserted=%d", written)
    return written


def main() -> None:
    asyncio.run(run_etl())


if __name__ == "__main__":
    main()
