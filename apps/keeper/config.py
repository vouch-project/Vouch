from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/keeper/config.py -> apps/keeper -> apps -> repo root
_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    # Read the monorepo root .env (where run-dev.sh / docker-compose keep shared config), then a
    # keeper-local .env if present. Actual environment variables still take precedence over both,
    # so `pnpm dev` (which exports root .env) and `turbo run dev` (which doesn't) both work.
    model_config = SettingsConfigDict(
        env_file=(str(_ROOT_ENV), ".env"),
        extra="ignore",
    )

    keeper_rpc_url: str = "http://localhost:8545"
    # The vault + lens addresses are the same ones the rest of the stack already publishes, so read
    # them straight from PUBLIC_VOUCH_VAULT(_LENS)_ADDRESS instead of a duplicated KEEPER_* var.
    keeper_contract_address: str = Field(
        validation_alias="public_vouch_vault_address",
    )
    keeper_lens_address: str = Field(
        validation_alias="public_vouch_vault_lens_address",
    )
    keeper_private_key: str
    keeper_network_id: int
    keeper_poll_interval_seconds: int = 60
    supabase_url: str
    supabase_secret_key: str
