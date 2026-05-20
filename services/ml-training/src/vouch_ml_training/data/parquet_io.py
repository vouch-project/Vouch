"""Parquet snapshots of the training_dataset table.

Workflow:
    Supabase (source of truth, idempotent upsert)
        |
        v
    parquet snapshot (frozen, versioned, portable)
        |
        v
    XGBoost trainer (reads parquet)

Snapshot files live at services/ml-training/data/snapshots/ and are named
`<featureSetVersion>__<UTC ISO timestamp>.parquet`. A `*__latest.parquet`
pointer (symlink, falling back to a copy) tracks the most recent snapshot
for each feature-set version.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import polars as pl

from vouch_ml_training.config import Settings
from vouch_ml_training.data.load import get_supabase_client
from vouch_ml_training.logging import get_logger

log = get_logger(__name__)

# services/ml-training/data/snapshots/
_SNAPSHOT_DIR = Path(__file__).resolve().parents[3] / "data" / "snapshots"

_TABLE = "training_dataset"


def _fetch_all_rows(settings: Settings) -> pl.DataFrame:
    """Read every row for the current featureSetVersion out of Supabase.

    PostgREST caps responses at 1000 rows, so we paginate by row offset.
    """
    client = get_supabase_client(settings)
    page_size = 1000
    offset = 0
    chunks: list[pl.DataFrame] = []
    while True:
        res = (
            client.table(_TABLE)
            .select("*")
            .eq("featureSetVersion", settings.feature_set_version)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = res.data
        if not rows:
            break
        # `infer_schema_length=None` => scan every row so jsonb / mixed-type
        # columns (rawFeatures) infer correctly even when early rows are sparse.
        chunks.append(pl.from_dicts(rows, infer_schema_length=None))
        if len(rows) < page_size:
            break
        offset += page_size

    if not chunks:
        return pl.DataFrame()
    return pl.concat(chunks, how="diagonal_relaxed")


def export_snapshot(settings: Settings | None = None) -> Path:
    """Snapshot the current training_dataset to a versioned parquet file."""
    from vouch_ml_training.config import get_settings

    settings = settings or get_settings()

    df = _fetch_all_rows(settings)
    if df.is_empty():
        raise RuntimeError(
            f"training_dataset is empty for featureSetVersion={settings.feature_set_version!r}; "
            "run `build-dataset` first"
        )

    _SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")
    out = _SNAPSHOT_DIR / f"{settings.feature_set_version}__{ts}.parquet"
    df.write_parquet(out, compression="zstd")

    # Refresh the "latest" pointer for this feature-set version.
    latest = _SNAPSHOT_DIR / f"{settings.feature_set_version}__latest.parquet"
    latest.unlink(missing_ok=True)
    try:
        latest.symlink_to(out.name)  # relative symlink
    except OSError:
        # Filesystems without symlink support: fall back to a copy.
        df.write_parquet(latest, compression="zstd")

    log.info(
        "snapshot written: %s (rows=%d, size=%.1fKB)",
        out, df.height, out.stat().st_size / 1024,
    )
    return out


def load_latest_snapshot(settings: Settings | None = None) -> pl.DataFrame:
    """Load the most recent parquet snapshot for the current feature-set version."""
    from vouch_ml_training.config import get_settings

    settings = settings or get_settings()

    latest = _SNAPSHOT_DIR / f"{settings.feature_set_version}__latest.parquet"
    if latest.exists():
        return pl.read_parquet(latest)

    candidates = sorted(_SNAPSHOT_DIR.glob(f"{settings.feature_set_version}__*.parquet"))
    if not candidates:
        raise FileNotFoundError(
            f"No parquet snapshot for featureSetVersion={settings.feature_set_version!r} in "
            f"{_SNAPSHOT_DIR}; run `vouch-ml-training export-parquet` first"
        )
    return pl.read_parquet(candidates[-1])
