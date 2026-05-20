"""Shared data types passed between ETL stages."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class LiquidationAggregate(BaseModel):
    """Per-wallet rollup of LiquidationCall events from the Aave V3 subgraph."""

    address: str
    liquidation_count: int
    first_liquidation_at: datetime
    last_liquidation_at: datetime
    total_principal_usd: float


class SafeBorrower(BaseModel):
    """Aave V3 borrower that has never been liquidated (negative class)."""

    address: str
    borrows_count: int
    total_borrowed_usd: float
    last_borrow_at: datetime | None = None


class WalletEnrichment(BaseModel):
    """On-chain metadata fetched from Etherscan + RPC for a single wallet."""

    address: str
    wallet_age_days: int | None = None
    total_transactions: int | None = None
    eth_balance: float | None = None
    stablecoin_balance_usd: float | None = None
    unique_protocols_interacted: int | None = None


class TrainingRow(BaseModel):
    """One row destined for the `training_dataset` Supabase table."""

    address: str
    chain_id: int
    label_is_risky: bool
    label_source: str
    snapshot_at: datetime
    wallet_age_days: int | None = None
    total_transactions: int | None = None
    historical_liquidation_count: int | None = None
    aave_borrows_count: int | None = None
    aave_total_borrowed_usd: float | None = None
    eth_balance: float | None = None
    stablecoin_balance_usd: float | None = None
    unique_protocols_interacted: int | None = None
    raw_features: dict[str, Any] = Field(default_factory=dict)
    feature_set_version: str = "cold_start_v1"
