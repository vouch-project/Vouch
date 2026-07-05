# Design: Keeper Bot

**Branch:** `feat/keeper-bot`  
**Date:** 2026-07-05

## Overview

A Python async polling loop that monitors on-chain loans and automatically calls `liquidate()` for undercollateralized active loans and `expireLoan()` for expired or undercollateralized pending loans. Runs as a standalone Docker service in `apps/keeper/`.

---

## Architecture

Single process, single async polling loop. On each tick:

1. Query Supabase for all loans with `status IN ('active', 'pending')`
2. For each loan, evaluate eligibility (see Decision Logic below)
3. Submit `liquidate()` or `expireLoan()` transaction if eligible
4. Log outcome; sleep `KEEPER_POLL_INTERVAL_SECONDS` until next tick

### Module structure

```
apps/keeper/
├── main.py          # Entry point — wires config/chain/db, runs the loop
├── config.py        # Env var parsing via pydantic-settings
├── chain.py         # web3 wrapper: get_health_factor(), liquidate(), expire_loan()
├── db.py            # Supabase wrapper: get_actionable_loans()
└── tests/
    └── test_keeper.py
```

---

## Decision Logic

### Active loans (`status = 'active'`, funded)

1. Call `getHealthFactor(loanId)` via `eth_call`
2. HF < 1e18 → call `liquidate(loanId)` (logs revert as warning — not yet implemented on contract)
3. HF ≥ 1e18 → skip

### Pending loans (`status = 'pending'`, unfunded)

1. If `fundDeadline < now` (DB field) → call `expireLoan(loanId)` directly (no HF call needed)
2. Else → call `getHealthFactor(loanId)`:
   - Revert with `"No price feed for token"` → no feeds configured, skip
   - HF < 1e18 → call `expireLoan(loanId)`
   - HF ≥ 1e18 → skip

The contract enforces all preconditions, so a `liquidate`/`expireLoan` revert on an ineligible loan is safe — the keeper logs it as a warning and continues.

---

## Configuration

New env vars added to `.env.example`:

| Variable | Description | Default |
|----------|-------------|---------|
| `KEEPER_RPC_URL` | JSON-RPC endpoint | `http://localhost:8545` |
| `KEEPER_CONTRACT_ADDRESS` | Deployed VouchVault address | — |
| `KEEPER_PRIVATE_KEY` | EOA private key for submitting txs | — |
| `KEEPER_POLL_INTERVAL_SECONDS` | Seconds between loop ticks | `60` |

Existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are reused.

---

## Error Handling

| Situation | Behavior |
|-----------|----------|
| RPC unreachable on startup | Crash immediately |
| Supabase unreachable on startup | Crash immediately |
| `getHealthFactor` reverts | Log + skip that loan |
| `liquidate`/`expireLoan` reverts | Log warning + skip (not a crash) |
| Unexpected exception mid-loop | Log exception + continue loop |

---

## Testing

Unit tests in `tests/test_keeper.py` using mock web3 provider and mock Supabase client. One test per decision branch:

- Active loan with HF < 1e18 → `liquidate()` called
- Active loan with HF ≥ 1e18 → no tx submitted
- Pending loan with deadline passed → `expireLoan()` called (no HF call)
- Pending loan within deadline, no price feeds → `expireLoan()` not called
- Pending loan within deadline, HF < 1e18 → `expireLoan()` called
- Pending loan within deadline, HF ≥ 1e18 → no tx submitted
- `liquidate()` reverts → loop continues, no crash
- `expireLoan()` reverts → loop continues, no crash

---

## Out of Scope

- Gas price strategy (use web3's default estimate)
- Caller incentives / profit tracking
- Alerting (Slack, PagerDuty, etc.)
- Retry logic on failed transactions
- Switching to contract-direct enumeration at scale
