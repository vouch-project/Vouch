"""Source 1: Aave V3 subgraph extraction.

Pulls liquidated borrowers (positive class) and never-liquidated borrowers
(negative class) from the Aave V3 subgraph hosted on The Graph's
decentralized network.

Pagination strategy: timestamp-cursored, not skip-based, because the
subgraph caps `skip` at 5000. This also makes incremental pulls trivial
(just bound the cursor by the previous high-water mark).
"""

from __future__ import annotations

import asyncio
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


def _compute_repay_ratio(repay_count: int, borrow_count: int) -> float | None:
    """Repays / borrows, capped at 1.0. None if borrow_count is 0."""
    if borrow_count == 0:
        return None
    return min(repay_count / borrow_count, 1.0)


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

    # Fetch repay + borrow counts as of each wallet's liquidation timestamp so
    # that Aave features reflect the wallet state before the default, not after.
    pit_timestamps = {a.address: int(a.last_liquidation_at.timestamp()) for a in aggregates}
    async with httpx.AsyncClient() as client:
        rb_counts = await _fetch_wallet_repay_and_borrow_counts(
            client, settings.subgraph_url, [a.address for a in aggregates],
            pit_timestamps=pit_timestamps,
        )
    for agg in aggregates:
        repay_n, borrow_n, last_borrow_ts = rb_counts.get(agg.address, (0, 0, None))
        agg.borrows_count = borrow_n
        if last_borrow_ts is not None:
            agg.last_borrow_at = datetime.fromtimestamp(last_borrow_ts, tz=UTC)
        agg.aave_repay_ratio = _compute_repay_ratio(
            repay_count=repay_n,
            borrow_count=borrow_n,
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
                # `first_borrow_at` is provisional — only reflects the events seen
                # in the recent descending walk above. Overwritten below with the
                # wallet's true earliest borrow from the subgraph.
                first_borrow_at=datetime.fromtimestamp(min(timestamps), tz=UTC),
                last_borrow_at=datetime.fromtimestamp(max(timestamps), tz=UTC),
            )
        )

    # The descending paginated walk above only sees a wallet's *recent* borrows,
    # so `first_borrow_at` is artificially recent. Fetch each wallet's true
    # earliest borrow timestamp directly from the subgraph so the downstream
    # observation-window filter in `transform.build_training_rows` is meaningful.
    async with httpx.AsyncClient() as client:
        first_ts = await _fetch_first_borrow_timestamps(
            client, settings.subgraph_url, [b.address for b in out],
        )
    for b in out:
        ts = first_ts.get(b.address)
        if ts is not None:
            b.first_borrow_at = datetime.fromtimestamp(ts, tz=UTC)

    # Replace stream-derived borrow/repay counts with accurate per-wallet totals
    # using the same aliased batch query as risky wallets (no PIT constraint).
    # The descending walk above only captures borrows that fell in the collection
    # window, so `borrows_count` is systematically undercounted for active wallets
    # and `aaveRepayRatio` gets inflated (repay_count can exceed borrow_count).
    # This mismatch causes a training/inference distribution shift: check_wallet.py
    # fetches full borrow histories at inference, producing very different counts.
    async with httpx.AsyncClient() as client:
        rb_counts = await _fetch_wallet_repay_and_borrow_counts(
            client, settings.subgraph_url, [b.address for b in out],
        )
    for b in out:
        repay_n, borrow_n, _ = rb_counts.get(b.address, (0, 0, None))
        b.borrows_count = borrow_n
        b.aave_repay_ratio = _compute_repay_ratio(
            repay_count=repay_n,
            borrow_count=borrow_n,
        )

    out.sort(key=lambda b: (b.last_borrow_at or datetime.min.replace(tzinfo=UTC)), reverse=True)
    return out[:target_count]


# Max addresses aliased into a single GraphQL request. Kept modest so the
# rendered query stays well under typical subgraph payload limits.
_FIRST_BORROW_BATCH = 25
# Max concurrent batched requests to the subgraph.
_FIRST_BORROW_CONCURRENCY = 4


async def _fetch_first_borrow_timestamps(
    client: httpx.AsyncClient,
    url: str,
    addresses: list[str],
) -> dict[str, int]:
    """Return {address: earliest_borrow_unix_ts} for the given addresses.

    Uses GraphQL field aliases to batch multiple per-address queries into one
    request, with a small concurrency cap across batches.
    """
    if not addresses:
        return {}

    sem = asyncio.Semaphore(_FIRST_BORROW_CONCURRENCY)
    batches: list[list[str]] = [
        addresses[i : i + _FIRST_BORROW_BATCH]
        for i in range(0, len(addresses), _FIRST_BORROW_BATCH)
    ]

    log.info(
        "resolving true first_borrow_at for %d safe wallets in %d batches (size=%d, concurrency=%d)",
        len(addresses), len(batches), _FIRST_BORROW_BATCH, _FIRST_BORROW_CONCURRENCY,
    )
    completed = 0

    async def run_batch(batch: list[str]) -> dict[str, int]:
        nonlocal completed
        # Build an aliased query: a0, a1, ... each asking for the wallet's
        # single earliest borrow.
        fields = "\n".join(
            f'a{i}: borrows('
            f'where: {{user: "{addr}"}}, '
            f"orderBy: timestamp, orderDirection: asc, first: 1"
            f") {{ timestamp }}"
            for i, addr in enumerate(batch)
        )
        query = f"query FirstBorrows {{\n{fields}\n}}"
        async with sem:
            data = await _post_graphql(client, url, query, {})
        result: dict[str, int] = {}
        for i, addr in enumerate(batch):
            rows = data.get(f"a{i}") or []
            if rows:
                result[addr] = int(rows[0]["timestamp"])
        completed += 1
        if completed % 5 == 0 or completed == len(batches):
            log.info(
                "first_borrow batches %d/%d done", completed, len(batches),
            )
        return result

    merged: dict[str, int] = {}
    for batch_result in await asyncio.gather(*(run_batch(b) for b in batches)):
        merged.update(batch_result)
    log.info(
        "resolved true first_borrow_at for %d/%d safe wallets",
        len(merged), len(addresses),
    )
    return merged


_REPAY_BORROW_BATCH = 25
_REPAY_BORROW_CONCURRENCY = 4


async def _fetch_wallet_repay_and_borrow_counts(
    client: httpx.AsyncClient,
    url: str,
    addresses: list[str],
    pit_timestamps: dict[str, int] | None = None,
) -> dict[str, tuple[int, int, int | None]]:
    """Return {address: (repay_count, borrow_count, last_borrow_ts)} via batched aliased queries.

    If pit_timestamps is provided, each wallet's counts and last borrow are restricted
    to events before that wallet's cutoff timestamp. Used for risky wallets to compute
    Aave features as of the liquidation date rather than the snapshot date.
    """
    if not addresses:
        return {}

    sem = asyncio.Semaphore(_REPAY_BORROW_CONCURRENCY)
    batches: list[list[str]] = [
        addresses[i : i + _REPAY_BORROW_BATCH]
        for i in range(0, len(addresses), _REPAY_BORROW_BATCH)
    ]

    log.info(
        "fetching repay+borrow counts for %d wallets in %d batches (pit=%s)",
        len(addresses), len(batches), pit_timestamps is not None,
    )

    async def run_batch(batch: list[str]) -> dict[str, tuple[int, int, int | None]]:
        # Build aliased fields per address:
        #   r{i}  — repay count (up to 1000, optionally timestamp-bounded)
        #   b{i}  — borrow count (up to 1000, optionally timestamp-bounded)
        #   bl{i} — last borrow timestamp before cutoff (desc, first 1)
        parts = []
        for i, addr in enumerate(batch):
            ts_filter = ""
            if pit_timestamps and addr in pit_timestamps:
                ts_filter = f", timestamp_lt: {pit_timestamps[addr]}"
            parts.append(
                f'r{i}: repays(where: {{user: "{addr}"{ts_filter}}}, first: 1000) {{ id }}\n'
                f'b{i}: borrows(where: {{user: "{addr}"{ts_filter}}}, first: 1000) {{ id }}\n'
                f'bl{i}: borrows(where: {{user: "{addr}"{ts_filter}}}, orderBy: timestamp,'
                f' orderDirection: desc, first: 1) {{ timestamp }}'
            )
        query = "query RepayBorrowCounts {\n" + "\n".join(parts) + "\n}"
        async with sem:
            data = await _post_graphql(client, url, query, {})
        result: dict[str, tuple[int, int, int | None]] = {}
        for i, addr in enumerate(batch):
            repays = data.get(f"r{i}") or []
            borrows = data.get(f"b{i}") or []
            last_borrow = data.get(f"bl{i}") or []
            if len(repays) >= 1000 or len(borrows) >= 1000:
                log.warning(
                    "wallet %s: repay/borrow counts capped at 1000 (aliased query limit);"
                    " repay_ratio may be underestimated",
                    addr,
                )
            last_borrow_ts: int | None = int(last_borrow[0]["timestamp"]) if last_borrow else None
            result[addr] = (len(repays), len(borrows), last_borrow_ts)
        return result

    merged: dict[str, tuple[int, int, int | None]] = {}
    for batch_result in await asyncio.gather(*(run_batch(b) for b in batches)):
        merged.update(batch_result)
    return merged
