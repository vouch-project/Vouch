# Keeper Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the keeper bot that monitors active and pending loans and automatically calls `liquidate()` / `expireLoan()` when eligible.

**Architecture:** Single async polling loop in Python. On each tick, queries Supabase for `active` + `pending` loans, evaluates each loan's HF via `eth_call`, submits `liquidate()` or `expireLoan()` if eligible, then sleeps. Three focused modules (`config.py`, `db.py`, `chain.py`) plus the existing `main.py` which is rewritten to wire them together with the decision logic.

**Tech Stack:** Python 3.11, web3.py ≥ 7.6, httpx, pydantic-settings, pytest.

## Global Constraints

- Python 3.11+, all files in `apps/keeper/`.
- web3.py is `>=7.6.0` — use `signed.raw_transaction` (not `rawTransaction`), `w3.is_connected()`.
- `ContractLogicError` is the correct exception class for `require()` reverts: `from web3.exceptions import ContractLogicError`.
- HF threshold is `10**18` (1e18 as an integer, matching the contract's 1e18 scale).
- Decision logic lives in `process_loan(loan, chain)` — a plain function, not a method — so it can be unit-tested without running the async loop.
- All tests use `unittest.mock.MagicMock` only — no real chain or DB.
- `fund_deadline=None` in `ActionableLoan` means no deadline was set (borrower wanted indefinite window) — do NOT treat this as "deadline passed"; skip to HF check only.
- Contract ABIs are loaded at runtime from the generated JSON in `packages/abi/` (or `apps/keeper/abi` in the Docker image), produced by `packages/contracts/scripts/extract-abi.mjs`. Do not hand-maintain ABI copies in the keeper — this keeps the keeper's ABI in sync with the deployed contracts.
- `liquidate()` on the contract currently reverts with `"liquidate: not implemented"` — this is expected. The keeper calls it anyway; the revert is caught, logged as a warning, and the loop continues.
- `getHealthFactor` reverts with `"No price feed for token"` when price feeds are not configured. Catch this in the pending-loan path and skip (no feeds = no HF expiry).

---

### Task 1: Config + dependency setup

**Files:**

- Modify: `apps/keeper/pyproject.toml`
- Create: `apps/keeper/config.py`
- Modify: `.env.example` (root)

**Interfaces:**

- Produces: `Settings` class importable as `from config import Settings`. Fields: `keeper_rpc_url: str`, `keeper_contract_address: str`, `keeper_private_key: str`, `keeper_poll_interval_seconds: int`, `supabase_url: str`, `supabase_secret_key: str`. All read from environment; `keeper_rpc_url` defaults to `"http://localhost:8545"`, `keeper_poll_interval_seconds` defaults to `60`.

- [ ] **Step 1: Add `pydantic-settings` to `pyproject.toml`**

In `apps/keeper/pyproject.toml`, add `"pydantic-settings>=2.0.0"` to `dependencies`:

```toml
[project]
name = "vouch-keeper"
version = "0.1.0"
description = "Vouch Protocol Keeper / Liquidation Bot"
requires-python = ">=3.11"
dependencies = [
    "web3>=7.6.0",
    "httpx>=0.28.0",
    "pydantic>=2.10.0",
    "pydantic-settings>=2.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "ruff>=0.8.0",
    "mypy>=1.14.0",
]

[tool.ruff]
target-version = "py311"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B"]

[tool.mypy]
python_version = "3.11"
strict = true
```

- [ ] **Step 2: Create `apps/keeper/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    keeper_rpc_url: str = "http://localhost:8545"
    keeper_contract_address: str
    keeper_private_key: str
    keeper_poll_interval_seconds: int = 60
    supabase_url: str
    supabase_secret_key: str
```

- [ ] **Step 3: Add keeper env vars to `.env.example`**

Append to the end of the root `.env.example`:

```
# Keeper Bot
KEEPER_RPC_URL=http://localhost:8545
KEEPER_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
KEEPER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KEEPER_POLL_INTERVAL_SECONDS=60
```

- [ ] **Step 4: Install and verify**

```bash
cd apps/keeper && pip install -e ".[dev]"
python -c "from config import Settings; print('ok')"
```

Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add apps/keeper/pyproject.toml apps/keeper/config.py .env.example
git commit -m "feat(keeper): config module + pydantic-settings dependency"
```

---

### Task 2: `db.py` — Supabase loan fetcher

**Files:**

- Create: `apps/keeper/db.py`

**Interfaces:**

- Consumes: `Settings` from `config.py`
- Produces:
  - `ActionableLoan` dataclass with fields: `on_chain_loan_id: int`, `status: str` (`"active"` or `"pending"`), `fund_deadline: datetime | None`
  - `get_actionable_loans(settings: Settings) -> list[ActionableLoan]` — queries Supabase REST API, returns only loans with non-null `onChainLoanId`

- [ ] **Step 1: Create `apps/keeper/db.py`**

```python
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
        "select": "onChainLoanId,status,fundDeadline",
        "status": "in.(active,pending)",
        "onChainLoanId": "not.is.null",
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
```

- [ ] **Step 2: Verify import**

```bash
cd apps/keeper && python -c "from db import get_actionable_loans, ActionableLoan; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add apps/keeper/db.py
git commit -m "feat(keeper): db module — fetch actionable loans from Supabase"
```

---

### Task 3: `chain.py` — web3 contract wrapper

**Files:**

- Create: `apps/keeper/chain.py`

**Interfaces:**

- Consumes: `Settings` from `config.py`
- Produces: `VaultChain` class with methods:
  - `__init__(settings: Settings) -> None` — raises `RuntimeError` if RPC unreachable
  - `get_health_factor(loan_id: int) -> int` — calls `getHealthFactor(loanId)` via `eth_call`; raises `ContractLogicError` on revert
  - `liquidate(loan_id: int) -> None` — sends `liquidate(loanId)` transaction
  - `expire_loan(loan_id: int) -> None` — sends `expireLoan(loanId)` transaction

- [ ] **Step 1: Create `apps/keeper/chain.py`**

```python
from __future__ import annotations

import logging
from typing import Any

from web3 import Web3
from web3.contract.base import ContractFunction

from config import Settings

logger = logging.getLogger("vouch.keeper.chain")

_MINIMAL_ABI: list[dict[str, Any]] = [
    {
        "inputs": [{"internalType": "uint256", "name": "loanId", "type": "uint256"}],
        "name": "getHealthFactor",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "loanId", "type": "uint256"}],
        "name": "liquidate",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "loanId", "type": "uint256"}],
        "name": "expireLoan",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


class VaultChain:
    def __init__(self, settings: Settings) -> None:
        self._w3 = Web3(Web3.HTTPProvider(settings.keeper_rpc_url))
        if not self._w3.is_connected():
            raise RuntimeError(f"Cannot connect to RPC at {settings.keeper_rpc_url}")
        self._account = self._w3.eth.account.from_key(settings.keeper_private_key)
        self._contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(settings.keeper_contract_address),
            abi=_MINIMAL_ABI,
        )

    def get_health_factor(self, loan_id: int) -> int:
        result: int = self._contract.functions.getHealthFactor(loan_id).call()
        return result

    def liquidate(self, loan_id: int) -> None:
        self._send_tx(self._contract.functions.liquidate(loan_id))

    def expire_loan(self, loan_id: int) -> None:
        self._send_tx(self._contract.functions.expireLoan(loan_id))

    def _send_tx(self, fn: ContractFunction) -> None:  # type: ignore[type-arg]
        nonce = self._w3.eth.get_transaction_count(self._account.address)
        tx = fn.build_transaction(
            {
                "from": self._account.address,
                "nonce": nonce,
                "gas": 200_000,
            }
        )
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash)
        logger.info("tx %s mined in block %s", tx_hash.hex(), receipt["blockNumber"])
```

- [ ] **Step 2: Verify import**

```bash
cd apps/keeper && python -c "from chain import VaultChain; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add apps/keeper/chain.py
git commit -m "feat(keeper): chain module — web3 wrapper for getHealthFactor/liquidate/expireLoan"
```

---

### Task 4: Main loop + decision logic + tests

**Files:**

- Modify: `apps/keeper/main.py` (replace stub)
- Create: `apps/keeper/tests/__init__.py`
- Create: `apps/keeper/tests/conftest.py`
- Create: `apps/keeper/tests/test_keeper.py`

**Interfaces:**

- Consumes: `ActionableLoan` from `db.py`, `VaultChain` from `chain.py`, `Settings` from `config.py`
- Produces: `process_loan(loan: ActionableLoan, chain: VaultChain) -> None` (the testable decision unit), `HF_THRESHOLD: int = 10**18`

- [ ] **Step 1: Write failing tests**

Create `apps/keeper/tests/__init__.py` (empty):

```python

```

Create `apps/keeper/tests/conftest.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
```

Create `apps/keeper/tests/test_keeper.py`:

```python
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/keeper && pytest tests/test_keeper.py -v 2>&1 | tail -20
```

Expected: all 9 tests FAIL with `ImportError: cannot import name 'process_loan' from 'main'`

- [ ] **Step 3: Replace `apps/keeper/main.py` with full implementation**

```python
"""Vouch Protocol Keeper — monitors loans and calls liquidate/expireLoan."""

from __future__ import annotations

import asyncio
import logging
import signal
from datetime import datetime, timezone

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
        now = datetime.now(timezone.utc)
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
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd apps/keeper && pytest tests/test_keeper.py -v
```

Expected output:

```
tests/test_keeper.py::test_active_unhealthy_calls_liquidate PASSED
tests/test_keeper.py::test_active_healthy_no_liquidate PASSED
tests/test_keeper.py::test_liquidate_revert_does_not_crash PASSED
tests/test_keeper.py::test_pending_deadline_passed_calls_expire PASSED
tests/test_keeper.py::test_pending_deadline_passed_skips_hf_check PASSED
tests/test_keeper.py::test_pending_no_feeds_does_not_expire PASSED
tests/test_keeper.py::test_pending_within_deadline_unhealthy_calls_expire PASSED
tests/test_keeper.py::test_pending_within_deadline_healthy_no_expire PASSED
tests/test_keeper.py::test_expire_loan_revert_does_not_crash PASSED

9 passed
```

- [ ] **Step 5: Commit**

```bash
git add apps/keeper/main.py apps/keeper/tests/
git commit -m "feat(keeper): main loop, process_loan decision logic, and unit tests"
```
