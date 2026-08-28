from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import httpx

from config import Settings


@dataclass
class ActionableLoan:
    on_chain_loan_id: int
    status: str  # 'active' | 'pending'
    fund_deadline: datetime | None
    due_at: datetime | None


@dataclass
class ExpirableLendOffer:
    on_chain_offer_id: int
    accept_deadline: datetime


def _auth_headers(settings: Settings) -> dict[str, str]:
    return {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    }


def get_actionable_loans(settings: Settings) -> list[ActionableLoan]:
    headers = _auth_headers(settings)
    params = {
        "select": "onChainLoanId,status,fundDeadline,dueAt,chains!inner(networkId)",
        "status": "in.(active,pending)",
        "onChainLoanId": "not.is.null",
        "chains.networkId": f"eq.{settings.keeper_network_id}",
    }
    response = httpx.get(
        f"{settings.supabase_url}/rest/v1/loans",
        headers=headers,
        params=params,
        timeout=10.0,
    )
    response.raise_for_status()
    loans: list[ActionableLoan] = []
    for row in response.json():
        fund_deadline = None
        if row["fundDeadline"]:
            fund_deadline = datetime.fromisoformat(
                row["fundDeadline"].replace("Z", "+00:00")
            )
        due_at = None
        if row.get("dueAt"):
            due_at = datetime.fromisoformat(row["dueAt"].replace("Z", "+00:00"))
        loans.append(
            ActionableLoan(
                on_chain_loan_id=int(row["onChainLoanId"]),
                status=row["status"],
                fund_deadline=fund_deadline,
                due_at=due_at,
            )
        )
    return loans


def get_expirable_lend_offers(settings: Settings) -> list[ExpirableLendOffer]:
    """On-chain lend offers still 'pending' in the DB, for this keeper's network.

    Whether an offer is actually past its acceptDeadline is decided by the caller (and
    ultimately enforced on-chain by expireLendOffer). The DB row is flipped to 'expired'
    by the blockchain-listener once the LendOfferExpired event lands, so we only surface
    'pending' rows here.
    """
    params = {
        "select": "onChainOfferId,acceptDeadline,chains!inner(networkId)",
        "status": "eq.pending",
        "chains.networkId": f"eq.{settings.keeper_network_id}",
    }
    response = httpx.get(
        f"{settings.supabase_url}/rest/v1/lend_offers",
        headers=_auth_headers(settings),
        params=params,
        timeout=10.0,
    )
    response.raise_for_status()
    offers: list[ExpirableLendOffer] = []
    for row in response.json():
        offers.append(
            ExpirableLendOffer(
                on_chain_offer_id=int(row["onChainOfferId"]),
                accept_deadline=datetime.fromisoformat(
                    row["acceptDeadline"].replace("Z", "+00:00")
                ),
            )
        )
    return offers
