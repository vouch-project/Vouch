from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from web3.exceptions import ContractLogicError

from db import ActionableLoan, ExpirableLendOffer
from main import HF_THRESHOLD, process_lend_offer, process_loan

HEALTHY = HF_THRESHOLD + 1
SICK = HF_THRESHOLD - 1
NOW = datetime.now(UTC)
PAST = NOW - timedelta(hours=1)
FUTURE = NOW + timedelta(hours=24)


def make_loan(loan_id: int = 1, status: str = "active", fund_deadline: datetime | None = None, due_at: datetime | None = None) -> ActionableLoan:
    return ActionableLoan(on_chain_loan_id=loan_id, status=status, fund_deadline=fund_deadline, due_at=due_at)


def make_chain(hf: int = HEALTHY) -> MagicMock:
    chain = MagicMock()
    chain.get_health_factor.return_value = hf
    chain.liquidate.return_value = True
    return chain


# Active loan — health-factor triggered liquidation

def test_active_unhealthy_calls_liquidate() -> None:
    chain = make_chain(hf=SICK)
    process_loan(make_loan(1), chain)
    chain.liquidate.assert_called_once_with(1)


def test_active_unhealthy_liquidate_skipped_no_log() -> None:
    chain = make_chain(hf=SICK)
    chain.liquidate.return_value = False
    with patch("main.logger") as mock_log:
        process_loan(make_loan(1), chain)
        logged = " ".join(str(c) for c in mock_log.info.call_args_list)
        assert "liquidated" not in logged


def test_active_healthy_no_liquidate() -> None:
    chain = make_chain(hf=HEALTHY)
    process_loan(make_loan(2), chain)
    chain.liquidate.assert_not_called()


def test_liquidate_revert_does_not_crash() -> None:
    chain = make_chain(hf=SICK)
    chain.liquidate.side_effect = Exception("liquidate: not implemented")
    process_loan(make_loan(3), chain)  # must not raise


# Active loan — overdue triggered liquidation

def test_active_overdue_calls_liquidate_without_hf_check() -> None:
    chain = make_chain()
    process_loan(make_loan(1, due_at=PAST), chain)
    chain.liquidate.assert_called_once_with(1)
    chain.get_health_factor.assert_not_called()


def test_active_not_yet_due_healthy_no_liquidate() -> None:
    chain = make_chain(hf=HEALTHY)
    process_loan(make_loan(1, due_at=FUTURE), chain)
    chain.liquidate.assert_not_called()


def test_active_not_yet_due_unhealthy_calls_liquidate() -> None:
    chain = make_chain(hf=SICK)
    process_loan(make_loan(1, due_at=FUTURE), chain)
    chain.liquidate.assert_called_once_with(1)


def test_active_overdue_liquidate_revert_does_not_crash() -> None:
    chain = make_chain()
    chain.liquidate.side_effect = Exception("revert")
    process_loan(make_loan(1, due_at=PAST), chain)  # must not raise


# Pending loan tests

def test_pending_deadline_passed_calls_expire() -> None:
    chain = make_chain()
    process_loan(make_loan(4, status="pending", fund_deadline=PAST), chain)
    chain.expire_loan.assert_called_once_with(4)


def test_pending_deadline_passed_skips_hf_check() -> None:
    chain = make_chain()
    process_loan(make_loan(5, status="pending", fund_deadline=PAST), chain)
    chain.get_health_factor.assert_not_called()


def test_pending_no_feeds_does_not_expire() -> None:
    chain = MagicMock()
    chain.get_health_factor.side_effect = ContractLogicError("No price feed for token")
    process_loan(make_loan(6, status="pending", fund_deadline=FUTURE), chain)
    chain.expire_loan.assert_not_called()


def test_pending_within_deadline_unhealthy_calls_expire() -> None:
    chain = make_chain(hf=SICK)
    process_loan(make_loan(7, status="pending", fund_deadline=FUTURE), chain)
    chain.expire_loan.assert_called_once_with(7)


def test_pending_within_deadline_healthy_no_expire() -> None:
    chain = make_chain(hf=HEALTHY)
    process_loan(make_loan(8, status="pending", fund_deadline=FUTURE), chain)
    chain.expire_loan.assert_not_called()


def test_expire_loan_revert_does_not_crash() -> None:
    chain = MagicMock()
    chain.expire_loan.side_effect = Exception("revert: already expired")
    process_loan(make_loan(9, status="pending", fund_deadline=PAST), chain)  # must not raise


# Lend offer tests

def test_lend_offer_deadline_passed_calls_expire() -> None:
    chain = MagicMock()
    process_lend_offer(ExpirableLendOffer(on_chain_offer_id=10, accept_deadline=PAST), chain)
    chain.expire_lend_offer.assert_called_once_with(10)


def test_lend_offer_within_deadline_no_expire() -> None:
    chain = MagicMock()
    process_lend_offer(ExpirableLendOffer(on_chain_offer_id=11, accept_deadline=FUTURE), chain)
    chain.expire_lend_offer.assert_not_called()


def test_expire_lend_offer_revert_does_not_crash() -> None:
    chain = MagicMock()
    chain.expire_lend_offer.side_effect = Exception("revert: OfferNotActive")
    process_lend_offer(ExpirableLendOffer(on_chain_offer_id=12, accept_deadline=PAST), chain)  # must not raise
