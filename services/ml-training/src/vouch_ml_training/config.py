"""Environment-driven configuration for the ML training pipeline."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve to services/ml-training/.env regardless of where the CLI is invoked.
# config.py = .../services/ml-training/src/vouch_ml_training/config.py
#   parents[0] = vouch_ml_training
#   parents[1] = src
#   parents[2] = ml-training        ← .env lives here
_PACKAGE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """All runtime config, loaded from env (or services/ml-training/.env)."""

    model_config = SettingsConfigDict(
        env_file=_PACKAGE_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # The Graph
    the_graph_api_key: str = Field(default="", alias="THE_GRAPH_API_KEY")
    aave_v3_subgraph_id: str = Field(
        default="Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g",
        alias="AAVE_V3_SUBGRAPH_ID",
    )
    target_chain_id: int = Field(default=1, alias="TARGET_CHAIN_ID")

    # Etherscan
    etherscan_api_key: str = Field(default="", alias="ETHERSCAN_API_KEY")

    # RPC
    rpc_url: str = Field(default="", alias="RPC_URL")

    # Supabase
    supabase_url: str = Field(default="http://localhost:54321", alias="SUPABASE_URL")
    supabase_secret_key: str = Field(default="", alias="SUPABASE_SECRET_KEY")

    # ETL knobs
    target_risky_wallets: int = Field(default=2000, alias="TARGET_RISKY_WALLETS")
    target_safe_wallets: int = Field(default=2000, alias="TARGET_SAFE_WALLETS")
    http_concurrency: int = Field(default=4, alias="HTTP_CONCURRENCY")
    etherscan_rps: float = Field(default=4.0, alias="ETHERSCAN_RPS")
    feature_set_version: str = Field(default="cold_start_v1", alias="FEATURE_SET_VERSION")
    observation_window_days: int = Field(default=90, alias="OBSERVATION_WINDOW_DAYS")

    @property
    def subgraph_url(self) -> str:
        """Aave V3 subgraph URL on The Graph decentralized gateway."""
        if not self.the_graph_api_key:
            raise RuntimeError("THE_GRAPH_API_KEY is not set; cannot build subgraph URL")
        return (
            f"https://gateway.thegraph.com/api/{self.the_graph_api_key}"
            f"/subgraphs/id/{self.aave_v3_subgraph_id}"
        )

    @property
    def etherscan_base_url(self) -> str:
        """Etherscan v2 multichain endpoint."""
        return "https://api.etherscan.io/v2/api"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
