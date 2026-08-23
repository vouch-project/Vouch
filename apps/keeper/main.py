"""Vouch Protocol Keeper — monitors loans and calls liquidate/expireLoan."""

from __future__ import annotations

import asyncio
import logging
import signal
from datetime import UTC, datetime

from pydantic import ValidationError
from web3.exceptions import ContractLogicError

from chain import VaultChain
from config import Settings
from db import (
    ActionableLoan,
    ExpirableLendOffer,
    get_actionable_loans,
    get_expirable_lend_offers,
)

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
                logger.debug("skipping loan %s: no price feed configured", loan.on_chain_loan_id)
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


def process_lend_offer(offer: ExpirableLendOffer, chain: VaultChain) -> None:
    now = datetime.now(UTC)
    if offer.accept_deadline >= now:
        return
    try:
        chain.expire_lend_offer(offer.on_chain_offer_id)
        logger.info("expired lend offer %s (deadline passed)", offer.on_chain_offer_id)
    except Exception:
        logger.warning(
            "expire_lend_offer failed for offer %s",
            offer.on_chain_offer_id,
            exc_info=True,
        )


async def monitor_positions(settings: Settings, chain: VaultChain) -> None:
    logger.info("Keeper bot started. Monitoring positions…")
    while not shutdown_event.is_set():
        try:
            loans = get_actionable_loans(settings)
            logger.info("Checking %d loans…", len(loans))
            for loan in loans:
                process_loan(loan, chain)

            offers = get_expirable_lend_offers(settings)
            logger.info("Checking %d lend offers…", len(offers))
            for offer in offers:
                process_lend_offer(offer, chain)
        except Exception:
            logger.exception("Error during position monitoring cycle.")
        await asyncio.sleep(settings.keeper_poll_interval_seconds)
    logger.info("Keeper bot stopped.")


async def _connect(settings: Settings) -> VaultChain | None:
    """Build the chain client, retrying until the RPC is reachable or we're told to stop.

    In local dev the keeper often starts before the chain node is up; returning instead of
    raising keeps `turbo run dev` alive (a crash here would tear down the whole dev session).
    """
    while not shutdown_event.is_set():
        try:
            return VaultChain(settings)
        except Exception:
            logger.warning(
                "Cannot reach RPC at %s yet; retrying in %ds…",
                settings.keeper_rpc_url,
                settings.keeper_poll_interval_seconds,
                exc_info=True,
            )
        await asyncio.sleep(settings.keeper_poll_interval_seconds)
    return None


async def main() -> None:
    try:
        settings = Settings()
    except ValidationError as exc:
        # Keeper isn't configured — settings are missing or invalid (e.g. absent
        # KEEPER_PRIVATE_KEY / KEEPER_NETWORK_ID / PUBLIC_VOUCH_VAULT(_LENS)_ADDRESS, or a malformed
        # value). Exit cleanly instead of crashing so an unconfigured keeper doesn't tear down the
        # rest of `turbo run dev`. Set the vars in the root .env to enable it.
        issues = ", ".join(str(e["loc"][0]) for e in exc.errors())
        logger.warning(
            "Keeper not configured (settings invalid/incomplete: %s); not starting.", issues
        )
        return

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    chain = await _connect(settings)
    if chain is None:
        return

    await monitor_positions(settings, chain)


if __name__ == "__main__":
    asyncio.run(main())
