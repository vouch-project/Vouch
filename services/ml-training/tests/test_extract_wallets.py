"""Tests for Etherscan enrichment error handling and caching."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from tenacity import stop_after_attempt

from vouch_ml_training.config import Settings
from vouch_ml_training.data.extract_wallets import _RateLimiter, _etherscan_call

# A dummy request is required so that httpx.Response.raise_for_status() works.
_DUMMY_REQUEST = httpx.Request("GET", "https://api.etherscan.io/v2/api")


def _settings() -> Settings:
    return Settings(
        ETHERSCAN_API_KEY="test-key",
        TARGET_CHAIN_ID=1,
        RPC_URL="http://localhost:8545",
    )


@pytest.fixture(autouse=True)
def _disable_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """Disable tenacity retries so tests fail fast without sleeping."""
    monkeypatch.setattr(_etherscan_call.retry, "stop", stop_after_attempt(1))


@pytest.fixture
def limiter() -> _RateLimiter:
    return _RateLimiter(rps=100.0)


@pytest.fixture
def tmp_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cache_dir = tmp_path / "cache"
    monkeypatch.setattr(
        "vouch_ml_training.data.extract_wallets._CACHE_DIR", cache_dir
    )
    return cache_dir


async def test_error_response_is_not_cached(
    tmp_cache: Path, limiter: _RateLimiter
) -> None:
    """Etherscan errors (invalid key, NOTOK) should raise, not cache."""
    error_body = {"status": "0", "message": "NOTOK", "result": "Invalid API Key"}
    mock_resp = httpx.Response(200, json=error_body, request=_DUMMY_REQUEST)

    client = AsyncMock(spec=httpx.AsyncClient)
    client.get = AsyncMock(return_value=mock_resp)

    with pytest.raises(RuntimeError, match="Etherscan error"):
        await _etherscan_call(
            client,
            _settings(),
            {"module": "account", "action": "txlist", "address": "0xabc"},
            limiter,
        )

    assert not tmp_cache.exists() or not list(tmp_cache.iterdir())


async def test_no_transactions_found_is_cached(
    tmp_cache: Path, limiter: _RateLimiter
) -> None:
    """'No transactions found' is a valid empty result — should be cached."""
    empty_body = {
        "status": "0",
        "message": "No transactions found",
        "result": "No transactions found",
    }
    mock_resp = httpx.Response(200, json=empty_body, request=_DUMMY_REQUEST)

    client = AsyncMock(spec=httpx.AsyncClient)
    client.get = AsyncMock(return_value=mock_resp)

    result = await _etherscan_call(
        client,
        _settings(),
        {"module": "account", "action": "txlist", "address": "0xdef"},
        limiter,
    )

    assert result == empty_body
    assert tmp_cache.exists()
    cached_files = list(tmp_cache.iterdir())
    assert len(cached_files) == 1
    with gzip.open(cached_files[0], "rt") as f:
        assert json.load(f) == empty_body


async def test_rate_limit_raises_for_retry(
    tmp_cache: Path, limiter: _RateLimiter
) -> None:
    """Rate-limit responses should raise (for tenacity to retry) and not cache."""
    rate_body = {
        "status": "0",
        "message": "NOTOK",
        "result": "Max calls per sec rate limit reached (5/sec)",
    }
    mock_resp = httpx.Response(200, json=rate_body, request=_DUMMY_REQUEST)

    client = AsyncMock(spec=httpx.AsyncClient)
    client.get = AsyncMock(return_value=mock_resp)

    with pytest.raises(RuntimeError, match="rate limited"):
        await _etherscan_call(
            client,
            _settings(),
            {"module": "account", "action": "txlist", "address": "0x123"},
            limiter,
        )

    assert not tmp_cache.exists() or not list(tmp_cache.iterdir())
