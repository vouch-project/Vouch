from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from web3.exceptions import ContractLogicError

from db import ActionableLoan
from main import HF_THRESHOLD, process_loan

HEALTHY = HF_THRESHOLD + 1
SICK = HF_THRESHOLD - 1
NOW = datetime.now(timezone.utc)
PAST = NOW - timedelta(hours=1)
FUTURE = NOW + timedelta(hours=24)


def make_chain(hf: int = HEALTHY) -> MagicMock:
    chain = MagicMock()
    chain.get_health_factor.return_value = hf
    return chain


# Active loan tests

def test_active_unhealthy_calls_liquidate() -> None:
    loan = ActionableLoan(on_chain_loan_id=1, status="active", fund_deadline=None)
    chain = make_chain(hf=SICK)
    process_loan(loan, chain)
    chain.liquidate.assert_called_once_with(1)


def test_active_healthy_no_liquidate() -> None:
    loan = ActionableLoan(on_chain_loan_id=2, status="active", fund_deadline=None)
    chain = make_chain(hf=HEALTHY)
    process_loan(loan, chain)
    chain.liquidate.assert_not_called()


def test_liquidate_revert_does_not_crash() -> None:
    loan = ActionableLoan(on_chain_loan_id=3, status="active", fund_deadline=None)
    chain = make_chain(hf=SICK)
    chain.liquidate.side_effect = Exception("liquidate: not implemented")
    process_loan(loan, chain)  # must not raise


# Pending loan tests

def test_pending_deadline_passed_calls_expire() -> None:
    loan = ActionableLoan(on_chain_loan_id=4, status="pending", fund_deadline=PAST)
    chain = make_chain()
    process_loan(loan, chain)
    chain.expire_loan.assert_called_once_with(4)


def test_pending_deadline_passed_skips_hf_check() -> None:
    loan = ActionableLoan(on_chain_loan_id=5, status="pending", fund_deadline=PAST)
    chain = make_chain()
    process_loan(loan, chain)
    chain.get_health_factor.assert_not_called()


def test_pending_no_feeds_does_not_expire() -> None:
    loan = ActionableLoan(on_chain_loan_id=6, status="pending", fund_deadline=FUTURE)
    chain = MagicMock()
    chain.get_health_factor.side_effect = ContractLogicError("No price feed for token")
    process_loan(loan, chain)
    chain.expire_loan.assert_not_called()


def test_pending_within_deadline_unhealthy_calls_expire() -> None:
    loan = ActionableLoan(on_chain_loan_id=7, status="pending", fund_deadline=FUTURE)
    chain = make_chain(hf=SICK)
    process_loan(loan, chain)
    chain.expire_loan.assert_called_once_with(7)


def test_pending_within_deadline_healthy_no_expire() -> None:
    loan = ActionableLoan(on_chain_loan_id=8, status="pending", fund_deadline=FUTURE)
    chain = make_chain(hf=HEALTHY)
    process_loan(loan, chain)
    chain.expire_loan.assert_not_called()


def test_expire_loan_revert_does_not_crash() -> None:
    loan = ActionableLoan(on_chain_loan_id=9, status="pending", fund_deadline=PAST)
    chain = MagicMock()
    chain.expire_loan.side_effect = Exception("revert: already expired")
    process_loan(loan, chain)  # must not raise
