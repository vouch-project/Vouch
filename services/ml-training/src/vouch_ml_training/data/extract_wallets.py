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

_STABLECOIN_CONTRACTS: list[tuple[str, int]] = [
    ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),   # USDC
    ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),   # USDT
    ("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),  # DAI
]

_BALANCE_OF_SELECTOR = "0x70a08231"


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
    #
    # Scope the key by chain id + base URL so cache entries from one
    # network (e.g. mainnet) can't be reused for another (e.g. sepolia)
    # when the same address/action is requested.
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
    # Etherscan uses status="0" for all error states, with result as a string message.
    # Rate-limit errors should be retried. "no transactions found" is a valid empty
    # result that gets cached. Everything else is a fatal configuration/permission error.
    result = body.get("result")
    if body.get("status") == "0" and isinstance(result, str):
        msg = result.lower()
        if "rate limit" in msg or "max calls" in msg or "too many" in msg:
            raise RuntimeError(f"Etherscan rate limited: {result}")
        if "no transactions found" not in msg:
            raise RuntimeError(f"Etherscan error: {result}")

    # Only cache successful responses and valid "no transactions" results.
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(cache_file, "wt", encoding="utf-8") as fh:
        json.dump(body, fh)
    return body


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    reraise=True,
)
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


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    reraise=True,
)
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


async def _fetch_stablecoin_balance(
    client: httpx.AsyncClient,
    settings: Settings,
    address: str,
) -> float:
    """Sum USD-equivalent stablecoin balance across USDC, USDT, DAI."""
    addr_padded = address.lower().replace("0x", "").zfill(64)
    calldata = f"{_BALANCE_OF_SELECTOR}{addr_padded}"

    calls: list[tuple[str, list[Any]]] = [
        ("eth_call", [{"to": contract, "data": calldata}, "latest"])
        for contract, _ in _STABLECOIN_CONTRACTS
    ]
    results = await _rpc_batch(client, settings, calls)

    total_usd = 0.0
    for raw_hex, (_, decimals) in zip(results, _STABLECOIN_CONTRACTS):
        if raw_hex and raw_hex != "0x":
            balance = int(raw_hex, 16) / (10 ** decimals)
            total_usd += balance
    return total_usd


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
                # Only count transactions with non-empty input data (contract calls).
                # Plain ETH transfers have input="0x" and would inflate the count.
                contracts = {
                    (t.get("to") or "").lower()
                    for t in tx_list
                    if t.get("to") and t.get("input", "0x") not in ("0x", "")
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

            stablecoin_usd = await _fetch_stablecoin_balance(client, settings, address)

            return WalletEnrichment(
                address=address,
                wallet_age_days=age_days,
                total_transactions=total_tx,
                eth_balance=eth_balance,
                unique_protocols_interacted=unique_contracts,
                stablecoin_balance_usd=stablecoin_usd,
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
    total = len(addresses)
    log.info(
        "enrichment start | wallets=%d concurrency=%d etherscan_rps=%.2f",
        total, settings.http_concurrency, settings.etherscan_rps,
    )
    limiter = _RateLimiter(settings.etherscan_rps)
    semaphore = asyncio.Semaphore(settings.http_concurrency)

    # Log progress every ~5% (min 10, max 100) so 1k+ wallet runs aren't silent.
    log_every = max(10, min(100, total // 20 or 1))
    done = 0
    failures = 0
    start = time.monotonic()
    results: list[WalletEnrichment] = [None] * total  # type: ignore[list-item]

    async def _run(idx: int, addr: str, client: httpx.AsyncClient) -> None:
        nonlocal done, failures
        enrichment = await _enrich_one(client, settings, addr, limiter, semaphore)
        results[idx] = enrichment
        done += 1
        # WalletEnrichment with all-None on-chain fields means _enrich_one
        # hit the except branch.
        if (
            enrichment.wallet_age_days is None
            and enrichment.total_transactions is None
            and enrichment.eth_balance is None
        ):
            failures += 1
        if done % log_every == 0 or done == total:
            elapsed = time.monotonic() - start
            rate = done / elapsed if elapsed > 0 else 0.0
            remaining = (total - done) / rate if rate > 0 else 0.0
            log.info(
                "enrichment progress %d/%d (%.1f%%) | failures=%d | %.1f wallets/s | eta=%.0fs",
                done, total, 100.0 * done / total, failures, rate, remaining,
            )

    async with httpx.AsyncClient() as client:
        await asyncio.gather(
            *[_run(i, a, client) for i, a in enumerate(addresses)]
        )

    log.info(
        "enrichment done | wallets=%d failures=%d elapsed=%.1fs",
        total, failures, time.monotonic() - start,
    )
    return results
