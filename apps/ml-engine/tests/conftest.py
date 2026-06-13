# apps/ml-engine/tests/conftest.py
"""Session-wide test configuration.

Sets dummy env vars that satisfy pydantic-settings required fields before any
module-level import (e.g. `from main import app`) triggers Settings().
"""
import os

import pytest

# Set required env vars before any test module is imported.
# These values are never used to make real network calls in the test suite.
_TEST_ENV = {
    "THE_GRAPH_API_KEY": "test-graph-key",
    "AAVE_V3_SUBGRAPH_ID": "test-subgraph-id",
    "ETHERSCAN_API_KEY": "test-etherscan-key",
    "RPC_URL": "https://rpc.example.com",
}

for _k, _v in _TEST_ENV.items():
    os.environ.setdefault(_k, _v)

# Pin ARTIFACT_PATH to a nonexistent directory so CreditScorer always starts
# in no-model mode regardless of whether a real artifact exists locally.
# Use setdefault so a developer can override with a real path if needed.
os.environ.setdefault("ARTIFACT_PATH", "/nonexistent/artifact/path")


@pytest.fixture(autouse=True)
def _reset_settings_singleton():
    """Reset the Settings singleton between tests so monkeypatch env changes take effect."""
    import src.config as cfg

    original = cfg._settings
    cfg._settings = None
    # Also clear ARTIFACT_PATH during the test so monkeypatch.setenv can override it cleanly.
    prev_artifact_path = os.environ.pop("ARTIFACT_PATH", None)
    yield
    cfg._settings = original
    if prev_artifact_path is not None:
        os.environ["ARTIFACT_PATH"] = prev_artifact_path
