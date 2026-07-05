"""Vouch Protocol Keeper — monitors loans and calls liquidate/expireLoan."""

from __future__ import annotations

import asyncio
import logging
import signal
from datetime import UTC, datetime

from web3.exceptions import ContractLogicError

from chain import VaultChain
from config import Settings
from db import ActionableLoan, get_actionable_loans

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vouch.keeper")

HF_THRESHOLD = 10**18

shutdown_event = asyncio.Event()


def _handle_signal() -> None:
    logger.info("Shutdown signal received.")
    shutdown_event.set()


def process_loan(loan: ActionableLoan, chain: VaultChain) -> None:
    if loan.status == "active":
        try:
            hf = chain.get_health_factor(loan.on_chain_loan_id)
        except Exception:
            logger.exception("get_health_factor failed for loan %s", loan.on_chain_loan_id)
            return
        if hf < HF_THRESHOLD:
            try:
                chain.liquidate(loan.on_chain_loan_id)
                logger.info("liquidated loan %s (hf=%s)", loan.on_chain_loan_id, hf)
            except Exception:
                logger.warning(
                    "liquidate failed for loan %s", loan.on_chain_loan_id, exc_info=True
                )

    elif loan.status == "pending":
        now = datetime.now(UTC)
        if loan.fund_deadline is not None and loan.fund_deadline < now:
            try:
                chain.expire_loan(loan.on_chain_loan_id)
                logger.info("expired loan %s (deadline passed)", loan.on_chain_loan_id)
            except Exception:
                logger.warning(
                    "expire_loan failed for loan %s", loan.on_chain_loan_id, exc_info=True
                )
            return
        try:
            hf = chain.get_health_factor(loan.on_chain_loan_id)
        except ContractLogicError as exc:
            if "No price feed" in str(exc):
                return
            logger.exception("get_health_factor failed for loan %s", loan.on_chain_loan_id)
            return
        except Exception:
            logger.exception("get_health_factor failed for loan %s", loan.on_chain_loan_id)
            return
        if hf < HF_THRESHOLD:
            try:
                chain.expire_loan(loan.on_chain_loan_id)
                logger.info("expired loan %s (hf=%s)", loan.on_chain_loan_id, hf)
            except Exception:
                logger.warning(
                    "expire_loan failed for loan %s", loan.on_chain_loan_id, exc_info=True
                )


async def monitor_positions(settings: Settings, chain: VaultChain) -> None:
    logger.info("Keeper bot started. Monitoring positions…")
    while not shutdown_event.is_set():
        try:
            loans = get_actionable_loans(settings)
            logger.info("Checking %d loans…", len(loans))
            for loan in loans:
                process_loan(loan, chain)
        except Exception:
            logger.exception("Error during position monitoring cycle.")
        await asyncio.sleep(settings.keeper_poll_interval_seconds)
    logger.info("Keeper bot stopped.")


async def main() -> None:
    settings = Settings()
    chain = VaultChain(settings)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    await monitor_positions(settings, chain)


if __name__ == "__main__":
    asyncio.run(main())
