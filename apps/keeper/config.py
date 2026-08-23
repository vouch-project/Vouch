from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/keeper/config.py -> apps/keeper -> apps -> repo root. In Docker the code is copied to
# /app (no repo root above it), so guard against not having enough parents; there config comes
# from real environment variables anyway.
_parents = Path(__file__).resolve().parents
_root_candidate = _parents[2] / ".env" if len(_parents) > 2 else None
_ROOT_ENV = str(_root_candidate) if _root_candidate and _root_candidate.is_file() else None


class Settings(BaseSettings):
    # Read the monorepo root .env (where run-dev.sh / docker-compose keep shared config), then a
    # keeper-local .env if present. Actual environment variables still take precedence over both,
    # so `pnpm dev` (which exports root .env) and `turbo run dev` (which doesn't) both work.
    model_config = SettingsConfigDict(
        env_file=((_ROOT_ENV, ".env") if _ROOT_ENV else ".env"),
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
