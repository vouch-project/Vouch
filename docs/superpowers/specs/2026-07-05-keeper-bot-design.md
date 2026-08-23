# Design: Keeper Bot

**Branch:** `feat/keeper-bot`  
**Date:** 2026-07-05

## Overview

A Python async polling loop that monitors on-chain loans and automatically calls `liquidate()` for undercollateralized active loans and `expireLoan()` for expired or undercollateralized pending loans. It also expires stale lend offers (`expireLendOffer()`) whose accept deadline has passed. Runs as a standalone Docker service in `apps/keeper/`.

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
├── chain.py         # web3 wrapper: get_health_factor(), liquidate(), expire_loan(), expire_lend_offer()
├── db.py            # Supabase wrapper: get_actionable_loans(), get_expirable_lend_offers()
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

### Lend offers (`get_expirable_lend_offers`)

1. Fetch open lend offers with an `acceptDeadline`
2. If `acceptDeadline < now` → call `expireLendOffer(offerId)`
3. Else → skip

As with loans, a revert (e.g. offer already expired/filled) is caught, logged as a warning, and the loop continues.

---

## Configuration

Env vars consumed by the keeper (see `apps/keeper/config.py`):

| Variable                          | Description                                                         | Default                 |
| --------------------------------- | ------------------------------------------------------------------- | ----------------------- |
| `KEEPER_RPC_URL`                  | JSON-RPC endpoint                                                   | `http://localhost:8545` |
| `PUBLIC_VOUCH_VAULT_ADDRESS`      | Deployed VouchVault address (shared with the rest of the stack)     | —                       |
| `PUBLIC_VOUCH_VAULT_LENS_ADDRESS` | Deployed VouchVaultLens address (shared with the rest of the stack) | —                       |
| `KEEPER_PRIVATE_KEY`              | EOA private key for submitting txs                                  | —                       |
| `KEEPER_NETWORK_ID`               | Chain/network id used to scope Supabase queries                     | —                       |
| `KEEPER_POLL_INTERVAL_SECONDS`    | Seconds between loop ticks                                          | `60`                    |

The vault + lens addresses are read from the shared `PUBLIC_VOUCH_VAULT(_LENS)_ADDRESS` vars (via pydantic `validation_alias`) rather than duplicated `KEEPER_*` vars. Existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are reused.

---

## Error Handling

| Situation                                          | Behavior                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| Settings missing/invalid on startup                | Log warning + exit cleanly (don't crash `turbo run dev`)             |
| RPC unreachable on startup                         | Log warning + retry each poll interval until reachable (or shutdown) |
| Supabase unreachable during a tick                 | Log exception + retry on the next loop tick (keeper keeps running)   |
| `getHealthFactor` reverts                          | Log + skip that loan                                                 |
| `liquidate`/`expireLoan`/`expireLendOffer` reverts | Log warning + skip (not a crash)                                     |
| Unexpected exception mid-loop                      | Log exception + continue loop                                        |

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
