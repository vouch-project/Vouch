# Health Factor & Chainlink Oracle Integration

**Date:** 2026-06-27
**Issue:** #19 (partial — `getHealthFactor` + Chainlink + `liquidate` stub; full `liquidate` implementation deferred)
**Related:** #20 (TS utility), #21 (liquidation bot)

---

## Overview

Vouch loans are collateralized with a per-loan LTV threshold (`liquidationThresholdBps`) computed off-chain at creation time using token volatility and the borrower's credit score. This spec adds:

1. On-chain health factor computation backed by Chainlink price feeds
2. A `liquidate()` stub (enforces health check, emits event, reverts as not implemented)
3. A backend price-feed service that reads Chainlink and serves prices to the frontend
4. Frontend migration from hardcoded `TOKEN_META` to API-sourced prices
5. Health factor display on the borrower dashboard

The contract remains the enforcement source of truth. The frontend LTV preview is cosmetic but uses the same oracle prices to stay consistent.

---

## 1. Contract (`packages/contracts/contracts/VouchVault.sol`)

### 1.1 Loan Struct Addition

Append at the end of the `Loan` struct (preserves storage layout):

```solidity
uint16 liquidationThresholdBps; // e.g. 6452 = 64.52%; set at creation, never changes
```

### 1.2 New State Variables

Appended after existing state variables:

```solidity
mapping(address token => AggregatorV3Interface) public priceFeeds;
uint256 public constant STALE_PRICE_THRESHOLD = 1 hours;
```

`address(0)` is used as the key for the native ETH/USD feed.

### 1.3 New Functions

**`setPriceFeed(address token, address feed) external onlyOwner`**
Registers a Chainlink `AggregatorV3Interface` feed for a token address. Called during deployment/upgrade setup. No validation beyond non-zero feed address.

**`_getPrice(address token) internal view returns (uint256 priceWad)`**
- Calls `feed.latestRoundData()`
- Reverts if: feed not registered, price ≤ 0, `updatedAt` older than `STALE_PRICE_THRESHOLD`
- Normalizes to 18 decimals regardless of feed decimals (Chainlink feeds vary between 8–18)

**`getHealthFactor(uint256 loanId) external view returns (uint256)`**
Returns health factor scaled to 1e18 (1e18 = 1.0).

Formula:
```
lockedCollateral = collateralAmount - collateralReleased
remainingDebt    = totalDue - amountRepaid

lockedCollateralUSD = lockedCollateral * _getPrice(collateralToken)
remainingDebtUSD    = remainingDebt    * _getPrice(principalToken)

healthFactor = (lockedCollateralUSD * liquidationThresholdBps) / (remainingDebtUSD * 10000)
```

Reverts if: loan not funded, loan already repaid, remaining debt is zero.

**`liquidate(uint256 loanId) external nonReentrant`** _(stub)_
- Calls `getHealthFactor(loanId)` — reverts if `>= 1e18` ("Loan is not undercollateralized")
- Emits `LoanLiquidated(loanId, msg.sender, block.timestamp)`
- Reverts with `"liquidate: not implemented"`

### 1.4 Updated Functions

Both `createLoan` and `createLoanWithERC20` gain a `uint16 liquidationThresholdBps` parameter. Validation: `> 0` and `<= 10000`.

### 1.5 New Event

```solidity
event LoanLiquidated(uint256 indexed loanId, address indexed liquidator, uint256 timestamp);
```

### 1.6 Local Dev Setup

- Deploy `MockV3Aggregator` (from `@chainlink/contracts`) for ETH and MOCK tokens in `dev-setup.sh`
- Call `setPriceFeed` for each after VouchVault deployment
- Mock prices: ETH = $3200, MOCK = $1000 (matching current `TOKEN_META` for continuity)

---

## 2. API (`apps/api`)

### 2.1 Database Migration

Add columns to the `tokens` table:

```sql
ALTER TABLE tokens ADD COLUMN price_usd float8;
ALTER TABLE tokens ADD COLUMN volatility float4;
ALTER TABLE tokens ADD COLUMN price_feed_address text;
```

All nullable — existing rows are not broken. `price_feed_address` is the Chainlink feed contract address for this token on the relevant chain.

### 2.2 `PriceFeedService`

New service inside the existing `tokens` module:

- On startup and every 60s (configurable via env var `PRICE_FEED_INTERVAL_MS`): reads each token's `price_feed_address` from DB, calls `latestRoundData()` via ethers.js using the existing chain provider, normalizes price, upserts `price_usd` in DB
- Uses Redis (already running) with a 30s TTL to cache the price map so concurrent requests don't hammer the RPC node
- Stale price guard: same `STALE_PRICE_THRESHOLD = 1 hour` as the contract

**Volatility** is hardcoded in the service (not read from Chainlink — it doesn't provide this). Values below are stored into the `volatility` column on seed/migration so they are DB-driven and admin-editable without a code deploy:

| Token | Volatility |
|-------|-----------|
| USDC / USDT / DAI | 0.02 / 0.03 / 0.04 |
| ETH / WETH | 0.45 _(nudged down from 0.55 — brings base LTV to ~72%, closer to Aave's 80%)_ |
| BTC / WBTC | 0.50 |
| LINK | 0.70 |
| UNI | 0.75 |
| AAVE | 0.65 |
| MOCK | 0.25 |
| default (unknown) | 0.60 |

Future improvement: replace hardcoded values with a background job computing realized volatility (e.g., ATR, rolling std dev of daily returns) from Chainlink historical round data.

### 2.3 `GET /tokens`

Returns the token list enriched with `priceUsd` and `volatility`. Prices served from Redis cache. If a price is unavailable (feed not configured, RPC error), `priceUsd` is `null` for that token. The frontend `getTokenMeta()` falls back to `DEFAULT_TOKEN_META` (volatility 0.60, priceUsd 1) so the LTV bar still renders rather than crashing.

---

## 3. Frontend (`apps/web`)

### 3.1 Token Price Store

New `tokenPrices` Svelte store in `src/lib/stores/tokenPrices.svelte.ts`:
- Fetches `GET /tokens` on load and every 60s
- Shape: `Record<string, TokenMeta>` (same interface as current `TOKEN_META`)
- Exposes a `getTokenMeta(symbol)` helper that falls back to `DEFAULT_TOKEN_META` if symbol not found or prices not yet loaded

### 3.2 `ltv.ts` Changes

- Remove `TOKEN_META` hardcoded map
- Remove `getTokenMeta()` (moved to store)
- Update TODO comment: prices are now API-sourced from Chainlink feeds via backend; volatility is DB-driven and manually maintained (future: computed from historical price data)
- `baseLtv`, `scoreMult`, `maxLtv` remain pure functions — callers pass `TokenMeta` obtained from the store

### 3.3 `CreateLoan.svelte` Changes

- Import `tokenPrices` store instead of `getTokenMeta` from `ltv.ts`
- `collateralUsd` and `borrowUsd` derived from store prices (reactive, updates when store refreshes)
- No structural change to the LTV bar UI

### 3.4 Health Factor on Dashboard

- Add `getHealthFactor(loanId: bigint): Promise<bigint>` to `src/lib/wallet/vouchVault.ts`
- In `LoansTable.svelte` (or a new `HealthFactorBadge` component): for each active, funded, non-repaid loan, call `getHealthFactor` and display with three-tier coloring:
  - `≥ 1.5e18` → green "Safe"
  - `1.0e18 – 1.5e18` → yellow "Warning"
  - `< 1.0e18` → red "Liquidation Risk"

---

## 4. Out of Scope (this PR)

- Full `liquidate()` implementation (token transfers to lender + liquidator, liquidation bonus)
- Automated volatility computation from historical price data
- Issue #20 (standalone TS utility) — that ticket's formula is consistent with this design; can be implemented as a thin wrapper around `getHealthFactor` contract call or as a pure function for off-chain estimation
- Issue #21 (liquidation bot) — unblocked once this PR ships; bot calls `getHealthFactor` on-chain directly

---

## 5. Key Constraints

- Solidity storage layout: all new struct fields and state variables appended, never reordered
- `nonReentrant` modifier on `liquidate()` even as a stub — sets the pattern for the real implementation
- Contract is UUPS upgradeable — full `liquidate()` can be added in a future upgrade without touching existing loan data
- Chainlink feed addresses are per-chain — dev uses `MockV3Aggregator`, production uses real feed addresses configured via `setPriceFeed` after upgrade deployment
