# apps/ml-engine/src/config.py
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    the_graph_api_key: str
    aave_v3_subgraph_id: str
    etherscan_api_key: str
    rpc_url: str
    target_chain_id: int = 1
    etherscan_base_url: str = "https://api.etherscan.io/v2/api"
    http_concurrency: int = 4
    etherscan_rps: float = 2.5

    # Path to a specific artifact dir. If None, the scorer auto-selects the latest.
    artifact_path: Path | None = None

    @property
    def subgraph_url(self) -> str:
        return (
            f"https://gateway.thegraph.com/api/{self.the_graph_api_key}"
            f"/subgraphs/id/{self.aave_v3_subgraph_id}"
        )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
