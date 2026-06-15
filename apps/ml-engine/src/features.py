# apps/ml-engine/src/features.py
"""Fetch the 9-feature vector for a wallet address (subgraph + RPC + Etherscan).

Adapted from services/ml-training/scripts/check_wallet.py. Self-contained —
does not import from the ml-training package.
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import Settings, get_settings

_CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "cache" / "etherscan"

_STABLECOIN_CONTRACTS: list[tuple[str, int]] = [
    ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    ("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
]
_BALANCE_OF_SELECTOR = "0x70a08231"

_USER_BORROWS_QUERY = """
query UserBorrows($user: String!, $first: Int!, $skip: Int!) {
  borrows(
    first: $first
    skip: $skip
    where: { user: $user }
    orderBy: timestamp
    orderDirection: asc
  ) {
    id
    timestamp
    amount
    assetPriceUSD
    reserve { decimals }
  }
}
"""

_USER_REPAYS_QUERY = """
query UserRepays($user: String!, $first: Int!, $skip: Int!) {
  repays(first: $first skip: $skip where: { user: $user }
         orderBy: timestamp orderDirection: asc) { id }
}
"""


def _compute_days_since(unix_ts: int | None) -> int | None:
    if unix_ts is None:
        return None
    return max(0, (int(time.time()) - unix_ts) // 86400)


def _compute_repay_ratio(repay_count: int, borrow_count: int) -> float | None:
    if borrow_count == 0:
        return None
    return min(repay_count / borrow_count, 1.0)


def _to_usd(amount_raw: str, decimals: int, price_usd: str) -> float:
    return int(amount_raw) / (10**decimals) * float(price_usd)


class _RateLimiter:
    def __init__(self, rps: float) -> None:
        self._interval = 1.0 / max(rps, 0.1)
        self._next_slot = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            sleep_for = max(0.0, self._next_slot - now)
            if sleep_for:
                await asyncio.sleep(sleep_for)
            self._next_slot = max(now, self._next_slot) + self._interval


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=1, min=1, max=10), reraise=True)
async def _etherscan_call(
    client: httpx.AsyncClient,
    settings: Settings,
    params: dict[str, Any],
    limiter: _RateLimiter,
) -> dict[str, Any]:
    cache_material = {
        "params": params,
        "chainid": settings.target_chain_id,
        "base_url": settings.etherscan_base_url,
    }
    cache_key = hashlib.sha1(
        json.dumps(cache_material, sort_keys=True).encode(), usedforsecurity=False
    ).hexdigest()
    cache_file = _CACHE_DIR / f"{cache_key}.json.gz"
    if cache_file.exists():
        try:
            with gzip.open(cache_file, "rt", encoding="utf-8") as fh:
                return json.load(fh)  # type: ignore[no-any-return]
        except (json.JSONDecodeError, OSError):
            try:
                cache_file.unlink(missing_ok=True)
            except OSError:
                pass

    await limiter.acquire()
    full_params = {
        **params,
        "chainid": settings.target_chain_id,
        "apikey": settings.etherscan_api_key,
    }
    resp = await client.get(settings.etherscan_base_url, params=full_params, timeout=30.0)
    resp.raise_for_status()
    body: dict[str, Any] = resp.json()
    result = body.get("result")
    if body.get("status") == "0" and isinstance(result, str):
        msg = result.lower()
        if "rate limit" in msg or "max calls" in msg or "too many" in msg:
            raise RuntimeError(f"Etherscan rate limited: {result}")
        if "no transactions found" not in msg:
            raise RuntimeError(f"Etherscan error: {result}")

    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with gzip.open(cache_file, "wt", encoding="utf-8") as fh:
            json.dump(body, fh)
    except OSError:
        pass
    return body


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=1, max=30), reraise=True)
async def _rpc_batch(
    client: httpx.AsyncClient,
    settings: Settings,
    calls: list[tuple[str, list[Any]]],
) -> list[Any]:
    payload = [
        {"jsonrpc": "2.0", "id": i, "method": m, "params": p}
        for i, (m, p) in enumerate(calls)
    ]
    resp = await client.post(settings.rpc_url, json=payload, timeout=30.0)
    resp.raise_for_status()
    body = resp.json()
    by_id = {item["id"]: item for item in body}
    out: list[Any] = []
    for i, (method, _) in enumerate(calls):
        item = by_id.get(i, {})
        if "error" in item:
            raise RuntimeError(f"RPC error for {method}: {item['error']}")
        out.append(item.get("result"))
    return out


async def _fetch_stablecoin_balance(
    client: httpx.AsyncClient, settings: Settings, address: str
) -> float:
    addr_padded = address.lower().replace("0x", "").zfill(64)
    calldata = f"{_BALANCE_OF_SELECTOR}{addr_padded}"
    calls = [
        ("eth_call", [{"to": c, "data": calldata}, "latest"])
        for c, _ in _STABLECOIN_CONTRACTS
    ]
    results = await _rpc_batch(client, settings, calls)
    total = 0.0
    for raw_hex, (_, decimals) in zip(results, _STABLECOIN_CONTRACTS, strict=False):
        if raw_hex and raw_hex != "0x":
            total += int(raw_hex, 16) / (10**decimals)
    return total


async def _post_graphql(
    client: httpx.AsyncClient, url: str, query: str, variables: dict[str, Any]
) -> dict[str, Any]:
    resp = await client.post(url, json={"query": query, "variables": variables}, timeout=30.0)
    resp.raise_for_status()
    body = resp.json()
    if "errors" in body:
        raise RuntimeError(f"GraphQL errors: {body['errors']}")
    return body.get("data", {})  # type: ignore[no-any-return]


async def _fetch_aave_stats(
    client: httpx.AsyncClient, settings: Settings, address: str
) -> tuple[int, float, float | None, int | None]:
    """Return (borrows_count, total_usd, repay_ratio, last_borrow_ts)."""
    addr = address.lower()
    total_count = 0
    total_usd = 0.0
    last_borrow_ts: int | None = None
    page_size = 1000

    skip = 0
    while True:
        data = await _post_graphql(
            client,
            settings.subgraph_url,
            _USER_BORROWS_QUERY,
            {"user": addr, "first": page_size, "skip": skip},
        )
        rows: list[dict[str, Any]] = data.get("borrows", [])
        if not rows:
            break
        total_count += len(rows)
        for r in rows:
            total_usd += _to_usd(r["amount"], int(r["reserve"]["decimals"]), r["assetPriceUSD"])
            ts = int(r["timestamp"])
            if last_borrow_ts is None or ts > last_borrow_ts:
                last_borrow_ts = ts
        if len(rows) < page_size:
            break
        skip += page_size
        if skip >= 5000:
            break

    repay_count = 0
    skip = 0
    while True:
        data = await _post_graphql(
            client,
            settings.subgraph_url,
            _USER_REPAYS_QUERY,
            {"user": addr, "first": page_size, "skip": skip},
        )
        rows = data.get("repays", [])
        if not rows:
            break
        repay_count += len(rows)
        if len(rows) < page_size:
            break
        skip += page_size
        if skip >= 5000:
            break

    return total_count, total_usd, _compute_repay_ratio(repay_count, total_count), last_borrow_ts


_etherscan_limiter: _RateLimiter | None = None


def _get_limiter() -> _RateLimiter:
    global _etherscan_limiter
    if _etherscan_limiter is None:
        _etherscan_limiter = _RateLimiter(get_settings().etherscan_rps)
    return _etherscan_limiter


async def fetch_features(address: str) -> dict[str, float | int | None]:
    """Return the 9-feature dict in FEATURE_COLUMNS order."""
    settings = get_settings()
    limiter = _get_limiter()

    async with httpx.AsyncClient() as client:
        tx_resp = await _etherscan_call(
            client,
            settings,
            {
                "module": "account",
                "action": "txlist",
                "address": address,
                "startblock": 0,
                "endblock": 99999999,
                "page": 1,
                "offset": 10000,
                "sort": "asc",
            },
            limiter,
        )
        wallet_age_days: int | None = None
        unique_contracts: int | None = None
        tx_list = tx_resp.get("result")
        if isinstance(tx_list, list) and tx_list:
            first_ts = int(tx_list[0]["timeStamp"])
            wallet_age_days = max(0, (int(time.time()) - first_ts) // 86400)
            contracts = {
                (t.get("to") or "").lower()
                for t in tx_list
                if t.get("to") and t.get("input", "0x") not in ("0x", "")
            }
            contracts.discard("")
            unique_contracts = len(contracts)

        nonce_hex, balance_hex = await _rpc_batch(
            client,
            settings,
            [
                ("eth_getTransactionCount", [address, "latest"]),
                ("eth_getBalance", [address, "latest"]),
            ],
        )
        total_tx = int(nonce_hex, 16)
        eth_balance = int(balance_hex, 16) / 1e18

        stablecoin_usd = await _fetch_stablecoin_balance(client, settings, address)

        aave_count, aave_usd, repay_ratio, last_borrow_ts = await _fetch_aave_stats(
            client, settings, address
        )

    return {
        "walletAgeDays": wallet_age_days,
        "totalTransactions": total_tx,
        "aaveBorrowsCount": aave_count,
        "aaveTotalBorrowedUsd": aave_usd,
        "ethBalance": eth_balance,
        "stablecoinBalanceUsd": stablecoin_usd,
        "uniqueProtocolsInteracted": unique_contracts,
        "aaveDaysSinceLastBorrow": _compute_days_since(last_borrow_ts),
        "aaveRepayRatio": repay_ratio,
    }
