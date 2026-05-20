"""Source 2: per-wallet enrichment from Etherscan + RPC.

For each address we want:
  - wallet_age_days       : (now - timestamp of first ever tx)
  - total_transactions    : nonce (RPC) — fast and exact for EOAs
  - eth_balance           : RPC eth_getBalance
  - unique_protocols_interacted : count of distinct contracts called

We hit Etherscan with a token-bucket rate limiter and a bounded async
semaphore so 1k+ wallets can be enriched in a few minutes without
tripping rate limits. Etherscan responses are cached to disk (gzipped
JSON, ~10x smaller than raw) so repeat runs and feature-engineering
iteration don't re-hit the API.
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

from vouch_ml_training.config import Settings
from vouch_ml_training.data.types import WalletEnrichment
from vouch_ml_training.logging import get_logger

log = get_logger(__name__)

# Disk cache for Etherscan responses (per-wallet first-tx + history).
# Lives at services/ml-training/data/cache/etherscan/<sha1>.json.gz.
_CACHE_DIR = Path(__file__).resolve().parents[3] / "data" / "cache" / "etherscan"


class _RateLimiter:
    """Async token bucket; allows at most `rps` calls per second."""

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


@retry(
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def _etherscan_call(
    client: httpx.AsyncClient,
    settings: Settings,
    params: dict[str, Any],
    limiter: _RateLimiter,
) -> dict[str, Any]:
    # Disk cache: same params -> same response. txlist for an address is
    # append-only on the most-recent end, but for our features (first-tx
    # timestamp + distinct contracts in first 10k txs) the cached value is
    # stable enough for development. Delete data/cache/etherscan/ to bust.
    cache_key = hashlib.sha1(
        json.dumps(params, sort_keys=True).encode(), usedforsecurity=False
    ).hexdigest()
    cache_file = _CACHE_DIR / f"{cache_key}.json.gz"
    if cache_file.exists():
        try:
            with gzip.open(cache_file, "rt", encoding="utf-8") as fh:
                return json.load(fh)  # type: ignore[no-any-return]
        except (json.JSONDecodeError, OSError):
            cache_file.unlink(missing_ok=True)

    await limiter.acquire()
    full_params = {
        **params,
        "chainid": settings.target_chain_id,
        "apikey": settings.etherscan_api_key,
    }
    resp = await client.get(settings.etherscan_base_url, params=full_params, timeout=30.0)
    resp.raise_for_status()
    body: dict[str, Any] = resp.json()
    # Etherscan returns status="0" with `result` as a string for both
    # "rate limited" and "no records found". Distinguish: a rate-limit
    # message starts with "Max calls" or contains "rate limit" — we
    # raise so tenacity retries with backoff. Empty results are not an
    # error, the caller handles them.
    result = body.get("result")
    if body.get("status") == "0" and isinstance(result, str):
        msg = result.lower()
        if "rate limit" in msg or "max calls" in msg or "too many" in msg:
            raise RuntimeError(f"Etherscan rate limited: {result}")

    # Only cache successful responses (or "no records").
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(cache_file, "wt", encoding="utf-8") as fh:
        json.dump(body, fh)
    return body


async def _rpc_call(
    client: httpx.AsyncClient,
    settings: Settings,
    method: str,
    params: list[Any],
) -> Any:
    resp = await client.post(
        settings.rpc_url,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=30.0,
    )
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:
        raise RuntimeError(f"RPC error for {method}: {body['error']}")
    return body["result"]


async def _rpc_batch(
    client: httpx.AsyncClient,
    settings: Settings,
    calls: list[tuple[str, list[Any]]],
) -> list[Any]:
    """Batched JSON-RPC POST. One round-trip for N calls."""
    payload = [
        {"jsonrpc": "2.0", "id": i, "method": method, "params": params}
        for i, (method, params) in enumerate(calls)
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


async def _enrich_one(
    client: httpx.AsyncClient,
    settings: Settings,
    address: str,
    limiter: _RateLimiter,
    semaphore: asyncio.Semaphore,
) -> WalletEnrichment:
    async with semaphore:
        try:
            # ONE Etherscan call: first 10k txs ASC. From this we derive
            #   - walletAgeDays  (oldest tx's timeStamp)
            #   - uniqueProtocolsInteracted  (set of distinct `to` values)
            # 10k is Etherscan's per-call cap; for wallets with more history
            # we'd undercount unique contracts but the age stays accurate.
            tx_resp = await _etherscan_call(
                client, settings,
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
            age_days: int | None = None
            unique_contracts: int | None = None
            tx_list = tx_resp.get("result")
            if isinstance(tx_list, list) and tx_list:
                first_ts = int(tx_list[0]["timeStamp"])
                age_days = max(0, (int(time.time()) - first_ts) // 86400)
                contracts = {
                    (t.get("to") or "").lower()
                    for t in tx_list
                    if t.get("to")
                }
                contracts.discard("")
                unique_contracts = len(contracts)

            # Single batched RPC POST: nonce + balance in one round-trip.
            nonce_hex, balance_hex = await _rpc_batch(
                client, settings,
                [
                    ("eth_getTransactionCount", [address, "latest"]),
                    ("eth_getBalance", [address, "latest"]),
                ],
            )
            total_tx = int(nonce_hex, 16)
            eth_balance = int(balance_hex, 16) / 1e18

            return WalletEnrichment(
                address=address,
                wallet_age_days=age_days,
                total_transactions=total_tx,
                eth_balance=eth_balance,
                unique_protocols_interacted=unique_contracts,
                # stablecoin balance left for a future feature pass
                stablecoin_balance_usd=None,
            )
        except Exception as exc:
            # Best-effort enrichment: a single bad wallet should never sink the run.
            log.warning("enrichment failed for %s: %s", address, exc)
            return WalletEnrichment(address=address)


async def enrich_wallets(
    settings: Settings,
    addresses: list[str],
) -> list[WalletEnrichment]:
    """Enrich a list of addresses with on-chain metadata, in parallel."""
    limiter = _RateLimiter(settings.etherscan_rps)
    semaphore = asyncio.Semaphore(settings.http_concurrency)
    async with httpx.AsyncClient() as client:
        return await asyncio.gather(
            *[_enrich_one(client, settings, a, limiter, semaphore) for a in addresses]
        )
