from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    keeper_rpc_url: str = "http://localhost:8545"
    keeper_contract_address: str
    keeper_private_key: str
    keeper_network_id: int
    keeper_poll_interval_seconds: int = 60
    supabase_url: str
    supabase_secret_key: str
