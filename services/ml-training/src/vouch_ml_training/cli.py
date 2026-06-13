"""Typer CLI entrypoint: `vouch-ml-training build-dataset|train`."""

from __future__ import annotations

import asyncio

import typer

from vouch_ml_training.config import get_settings
from vouch_ml_training.logging import configure_logging, get_logger
from vouch_ml_training.pipelines.build_dataset import run_etl

app = typer.Typer(no_args_is_help=True, add_completion=False)
log = get_logger(__name__)


@app.command("build-dataset")
def build_dataset(
    risky: int | None = typer.Option(None, help="Override TARGET_RISKY_WALLETS"),
    safe: int | None = typer.Option(None, help="Override TARGET_SAFE_WALLETS"),
) -> None:
    """Run the ETL: scrape Aave -> enrich -> upsert into Supabase."""
    configure_logging()
    settings = get_settings()
    if risky is not None:
        settings.target_risky_wallets = risky
    if safe is not None:
        settings.target_safe_wallets = safe
    written = asyncio.run(run_etl(settings))
    typer.echo(f"upserted {written} rows")


@app.command("export-parquet")
def export_parquet_cmd() -> None:
    """Snapshot training_dataset to a versioned parquet file."""
    configure_logging()
    from vouch_ml_training.data.parquet_io import export_snapshot

    out = export_snapshot()
    typer.echo(f"snapshot={out}")


@app.command("train")
def train_cmd() -> None:
    """Train an XGBoost model on the populated training_dataset table."""
    configure_logging()
    # Imported lazily so that `build-dataset` works on machines that haven't
    # installed libomp / xgboost native deps yet.
    from vouch_ml_training.pipelines.train_xgboost import train

    result = train()
    typer.echo(f"model_version={result.model_version}")
    typer.echo(f"artifact={result.artifact_dir}")
    typer.echo(f"metrics={result.metrics}")


if __name__ == "__main__":
    app()
