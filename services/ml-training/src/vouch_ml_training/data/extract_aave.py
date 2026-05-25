"""Source 1: Aave V3 subgraph extraction.

Pulls liquidated borrowers (positive class) and never-liquidated borrowers
(negative class) from the Aave V3 subgraph hosted on The Graph's
decentralized network.

Pagination strategy: timestamp-cursored, not skip-based, because the
subgraph caps `skip` at 5000. This also makes incremental pulls trivial
(just bound the cursor by the previous high-water mark).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from vouch_ml_training.config import Settings
from vouch_ml_training.data.types import LiquidationAggregate, SafeBorrower
from vouch_ml_training.logging import get_logger

log = get_logger(__name__)

_PAGE_SIZE = 1000


_LIQUIDATION_QUERY = """
query Liquidations($first: Int!, $cursor: Int!) {
  liquidationCalls(
    first: $first
    where: { timestamp_lte: $cursor }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    timestamp
    user { id }
    principalAmount
    borrowAssetPriceUSD
    principalReserve { decimals symbol }
  }
}
"""

_BORROWS_QUERY = """
query Borrows($first: Int!, $cursor: Int!) {
  borrows(
    first: $first
    where: { timestamp_lte: $cursor }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    timestamp
    user { id }
    amount
    assetPriceUSD
    reserve { decimals symbol }
  }
}
"""


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    reraise=True,
)
async def _post_graphql(
    client: httpx.AsyncClient,
    url: str,
    query: str,
    variables: dict[str, Any],
) -> dict[str, Any]:
    resp = await client.post(
        url,
        json={"query": query, "variables": variables},
        timeout=60.0,
    )
    resp.raise_for_status()
    body: dict[str, Any] = resp.json()
    if body.get("errors"):
        raise RuntimeError(f"Subgraph errors: {body['errors']}")
    return body["data"]


def _to_usd(amount_raw: str, decimals: int, price_usd: str) -> float:
    """Convert raw on-chain amount + USD price (already a decimal string) into USD."""
    try:
        amount = float(amount_raw) / (10**decimals)
        price = float(price_usd)
        return amount * price
    except (ValueError, ZeroDivisionError):
        return 0.0


async def _paginate_by_timestamp(
    client: httpx.AsyncClient,
    url: str,
    query: str,
    root_key: str,
) -> AsyncIterator[dict[str, Any]]:
    """Yield subgraph rows ordered by timestamp desc, without skipping ties.

    The Aave V3 subgraph only supports a single `orderBy` field, so when many
    events share the same block timestamp a naive `timestamp_lt: cursor`
    cursor will drop ties straddling page boundaries. Instead we query with
    `timestamp_lte` and track the ids already yielded at the current boundary
    timestamp so we can dedupe across pages. When the boundary set is fully
    drained we step the cursor down by one second.
    """
    cursor_ts = 2_000_000_000  # far-future seconds-since-epoch
    seen_ids_at_cursor: set[str] = set()

    while True:
        data = await _post_graphql(
            client, url, query,
            {"first": _PAGE_SIZE, "cursor": cursor_ts},
        )
        rows: list[dict[str, Any]] = data.get(root_key, [])
        if not rows:
            return

        fresh = [r for r in rows if r["id"] not in seen_ids_at_cursor]
        if not fresh:
            # Entire page is rows we've already yielded at the boundary ts.
            # The subgraph would keep returning the same window forever
            # unless we drop below it.
            cursor_ts -= 1
            seen_ids_at_cursor.clear()
            continue

        for row in fresh:
            yield row

        page_min_ts = min(int(r["timestamp"]) for r in rows)
        if page_min_ts < cursor_ts:
            cursor_ts = page_min_ts
            seen_ids_at_cursor = {
                r["id"] for r in rows if int(r["timestamp"]) == cursor_ts
            }
        else:
            # Still on the same boundary ts; accumulate seen ids so the next
            # page skips them.
            seen_ids_at_cursor.update(r["id"] for r in fresh)


async def fetch_liquidated_wallets(
    settings: Settings,
    target_count: int,
) -> list[LiquidationAggregate]:
    """Walk the Aave V3 subgraph and aggregate liquidations per borrower.

    Returns at most `target_count` distinct addresses, sorted by recency of
    their most recent liquidation (descending).
    """
    by_addr: dict[str, list[dict[str, Any]]] = defaultdict(list)

    async with httpx.AsyncClient() as client:
        url = settings.subgraph_url
        fetched = 0
        async for row in _paginate_by_timestamp(
            client, url, _LIQUIDATION_QUERY, "liquidationCalls"
        ):
            addr = row["user"]["id"].lower()
            by_addr[addr].append(row)
            fetched += 1
            if fetched % _PAGE_SIZE == 0:
                log.info(
                    "liquidations: fetched=%d unique_wallets=%d",
                    fetched, len(by_addr),
                )
            if len(by_addr) >= target_count:
                break

    aggregates: list[LiquidationAggregate] = []
    for addr, events in by_addr.items():
        timestamps = [int(e["timestamp"]) for e in events]
        usd_values = [
            _to_usd(
                e["principalAmount"],
                int(e["principalReserve"]["decimals"]),
                e["borrowAssetPriceUSD"],
            )
            for e in events
        ]
        aggregates.append(
            LiquidationAggregate(
                address=addr,
                liquidation_count=len(events),
                first_liquidation_at=datetime.fromtimestamp(min(timestamps), tz=UTC),
                last_liquidation_at=datetime.fromtimestamp(max(timestamps), tz=UTC),
                total_principal_usd=sum(usd_values),
            )
        )

    aggregates.sort(key=lambda a: a.last_liquidation_at, reverse=True)
    return aggregates[:target_count]


async def fetch_safe_borrowers(
    settings: Settings,
    target_count: int,
    excluded_addresses: set[str],
) -> list[SafeBorrower]:
    """Fetch Aave V3 borrowers that have never been liquidated.

    `excluded_addresses` should be the set of liquidated wallets (lowercase)
    so we don't accidentally label a risky wallet as safe.
    """
    by_addr: dict[str, list[dict[str, Any]]] = defaultdict(list)

    async with httpx.AsyncClient() as client:
        url = settings.subgraph_url
        fetched = 0
        async for row in _paginate_by_timestamp(
            client, url, _BORROWS_QUERY, "borrows"
        ):
            addr = row["user"]["id"].lower()
            if addr in excluded_addresses:
                continue
            by_addr[addr].append(row)
            fetched += 1
            if fetched % _PAGE_SIZE == 0:
                log.info(
                    "borrows: fetched=%d distinct_safe=%d",
                    fetched, len(by_addr),
                )
            # `by_addr` only contains non-excluded wallets, so stop paging
            # once we have enough distinct safe borrowers collected.
            if len(by_addr) >= target_count:
                break

    out: list[SafeBorrower] = []
    for addr, events in by_addr.items():
        if addr in excluded_addresses:
            continue
        timestamps = [int(e["timestamp"]) for e in events]
        usd_values = [
            _to_usd(
                e["amount"],
                int(e["reserve"]["decimals"]),
                e["assetPriceUSD"],
            )
            for e in events
        ]
        out.append(
            SafeBorrower(
                address=addr,
                borrows_count=len(events),
                total_borrowed_usd=sum(usd_values),
                first_borrow_at=datetime.fromtimestamp(min(timestamps), tz=UTC),
                last_borrow_at=datetime.fromtimestamp(max(timestamps), tz=UTC),
            )
        )

    out.sort(key=lambda b: (b.last_borrow_at or datetime.min.replace(tzinfo=UTC)), reverse=True)
    return out[:target_count]
