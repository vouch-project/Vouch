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
    where: { timestamp_lt: $cursor }
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
    where: { timestamp_lt: $cursor }
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


async def fetch_liquidated_wallets(
    settings: Settings,
    target_count: int,
) -> list[LiquidationAggregate]:
    """Walk the Aave V3 subgraph and aggregate liquidations per borrower.

    Returns at most `target_count` distinct addresses, sorted by recency of
    their most recent liquidation (descending).
    """
    by_addr: dict[str, list[dict[str, Any]]] = defaultdict(list)
    # Far-future Int (Aave subgraph timestamps are seconds since epoch).
    cursor = 2_000_000_000

    async with httpx.AsyncClient() as client:
        url = settings.subgraph_url
        while len(by_addr) < target_count:
            data = await _post_graphql(
                client, url, _LIQUIDATION_QUERY,
                {"first": _PAGE_SIZE, "cursor": cursor},
            )
            rows: list[dict[str, Any]] = data.get("liquidationCalls", [])
            if not rows:
                log.info("Subgraph returned no more liquidations; stopping pagination")
                break

            for row in rows:
                addr = row["user"]["id"].lower()
                by_addr[addr].append(row)

            cursor = int(rows[-1]["timestamp"])
            log.info(
                "liquidations: fetched=%d unique_wallets=%d cursor=%s",
                len(rows), len(by_addr), cursor,
            )

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
    cursor = 2_000_000_000

    async with httpx.AsyncClient() as client:
        url = settings.subgraph_url
        # We need to over-sample because some borrowers will be in the
        # excluded set. Keep paging until we have enough fresh ones.
        while True:
            distinct_safe = sum(1 for a in by_addr if a not in excluded_addresses)
            if distinct_safe >= target_count:
                break

            data = await _post_graphql(
                client, url, _BORROWS_QUERY,
                {"first": _PAGE_SIZE, "cursor": cursor},
            )
            rows: list[dict[str, Any]] = data.get("borrows", [])
            if not rows:
                log.info("Subgraph returned no more borrows; stopping pagination")
                break

            for row in rows:
                addr = row["user"]["id"].lower()
                if addr in excluded_addresses:
                    continue
                by_addr[addr].append(row)

            cursor = int(rows[-1]["timestamp"])
            log.info(
                "borrows: fetched=%d distinct_safe=%d cursor=%s",
                len(rows), distinct_safe, cursor,
            )

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
                last_borrow_at=datetime.fromtimestamp(max(timestamps), tz=UTC),
            )
        )

    out.sort(key=lambda b: (b.last_borrow_at or datetime.min.replace(tzinfo=UTC)), reverse=True)
    return out[:target_count]
