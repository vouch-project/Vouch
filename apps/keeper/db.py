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


def get_actionable_loans(settings: Settings) -> list[ActionableLoan]:
    headers = {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    }
    params = {
        "select": "onChainLoanId,status,fundDeadline,chains!inner(networkId)",
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
        loans.append(
            ActionableLoan(
                on_chain_loan_id=int(row["onChainLoanId"]),
                status=row["status"],
                fund_deadline=fund_deadline,
            )
        )
    return loans
