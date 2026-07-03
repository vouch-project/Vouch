# Design: `liquidate()` for VouchVault (issue #19)

**Date:** 2026-07-03
**Scope:** Implement the actual liquidation mechanics in `VouchVault.sol`, replacing the
`liquidate: not implemented` stub. Eligibility checking (`getHealthFactor`) and the Chainlink
oracle integration already exist and are unchanged. The contract is **not yet deployed**, so
storage-layout append rules are followed as good practice but versioning/migration is not a concern.

## Goal

Let anyone clear an undercollateralized loan on behalf of the lender. The liquidator pays down the
loan and, in exchange, seizes the collateral. When the position is healthy-but-liquidatable the
liquidator pays the full debt, the lender is made whole, and any excess collateral returns to the
borrower. When the position is underwater the liquidator pays only what the collateral is worth (net
of the bonus), so liquidation remains profitable and still happens; the lender recovers that amount
and realizes the shortfall as a loss. Either way the loan ends fully closed.

### What we tell users

Collateralized ≠ risk-free. Like every collateralized lending protocol, a lender can lose money if
the collateral's market value falls through the loan's safety margin faster than the position can be
liquidated. The protections are: (1) the per-loan `liquidationThresholdBps` triggers liquidation
*before* collateral drops below the debt, leaving a cushion; (2) the protocol's own keeper liquidates
all eligible loans, not just profitable-for-third-parties ones; and (3) when a loss is unavoidable,
liquidation recovers as much as possible *immediately* rather than letting the position rot. The
per-loan threshold is the lender's risk dial — lower threshold, bigger cushion.

## Decisions (settled during brainstorming)

1. **Liquidation model — seize collateral, pay lender up to the debt (Aave-style).**
   The liquidator pays `liquidatorPays = min(debt, collateralValue / (1 + bonus))` and receives the
   collateral, priced via the existing oracle.
   - **Healthy-but-liquidatable** (`collateralValue ≥ debt × (1 + bonus)`): `liquidatorPays == debt`,
     lender is made whole, liquidator seizes collateral worth `debt × (1 + bonus)`, and the excess
     collateral returns to the borrower.
   - **Underwater** (`collateralValue < debt × (1 + bonus)`): `liquidatorPays < debt`, the liquidator
     takes **all** the collateral (still profiting by the bonus over what they paid), the borrower
     gets nothing, and the lender realizes a loss of `debt − liquidatorPays`.
   The two cases share one formula; the second is not a special-case branch, it's the same
   `min(...)` binding to its other argument.

2. **Full close only** (no partial / close-factor). One `liquidate` call clears the whole loan: the
   loan goes straight to fully-repaid/inactive. "Full close" refers to the loan lifecycle, not to the
   payment amount — the amount paid is `liquidatorPays`, which may be less than the debt when
   underwater.

3. **Two liquidation triggers — undercollateralized OR expired.** A loan is liquidatable when either:
   - `getHealthFactor(loanId) < 1e18` — collateral value has fallen below the threshold, or
   - `loan.durationSeconds > 0 && block.timestamp > loan.fundedAt + loan.durationSeconds` — the loan
     term expired and the borrower never repaid.
   The keeper bot handles both cases automatically so neither trigger depends on lender action.
   When a loan is healthy-but-expired the borrower still receives any excess collateral (the bonus
   comes out of their surplus, a fair consequence of time default). The revert message is
   `"Loan is not liquidatable"` to cover both triggers.

3. **Liquidation bonus — owner-settable bps with a hard cap** (mirrors `protocolFeeBps` /
   `minInterestBps`). Default `500` (5%), capped at `MAX_LIQUIDATION_BONUS_BPS = 2000` (20%).

4. **Two external entry points, one internal core.** `liquidate` (ETH principal, `payable`) and
   `liquidateWithERC20` (ERC20 principal) both delegate to `_liquidate`. This matches the existing
   `fundLoan`/`fundLoanWithERC20` and `repayLoan`/`repayLoanWithERC20` pairs. A single generic
   function was rejected: the ETH path must be `payable` and read `msg.value`, while the ERC20 path
   is non-payable and pulls an explicit `amount` via `transferFrom`; merging them yields an
   ambiguous signature with inert arguments and *more* defensive `require`s, not fewer.

5. **Enrich the `LoanLiquidated` event** (currently declared but never fired) with the amounts a
   keeper/indexer needs to react.

## Contract changes (`packages/contracts/contracts/VouchVault.sol`)

### Storage (appended, preserves layout)

```solidity
uint256 public liquidationBonusBps;                          // default 500 = 5%
uint256 public constant MAX_LIQUIDATION_BONUS_BPS = 2000;    // hard cap: 20%
```

`initialize` sets `liquidationBonusBps = 500`.

### Owner setter (mirrors `setProtocolFeeBps`)

```solidity
function setLiquidationBonusBps(uint256 newBonusBps) external onlyOwner {
    require(newBonusBps <= MAX_LIQUIDATION_BONUS_BPS, "Bonus exceeds max");
    liquidationBonusBps = newBonusBps;
    emit LiquidationBonusUpdated(newBonusBps);
}
```

New event: `event LiquidationBonusUpdated(uint256 bonusBps);`

### Enriched event

Replace the existing declaration:
```solidity
event LoanLiquidated(
    uint256 indexed loanId,
    address indexed liquidator,
    uint256 amountPaid,          // liquidatorPays: full debt when healthy, < debt when underwater
    uint256 collateralSeized,
    uint256 collateralReturned,
    uint256 timestamp
);
```

### External entry points

`liquidatorPays` depends on oracle math computed *inside* `_liquidate`, so it can't be required to
equal a fixed amount up front. Instead each entry point takes a **ceiling** — the most the caller is
willing to pay — which doubles as slippage protection against a price/interest move between
transaction submission and mining. The contract charges the computed `liquidatorPays` (≤ ceiling) and
returns any surplus.

```solidity
/// ETH-principal loans. Send at least the amount owed; any surplus msg.value is refunded.
function liquidate(uint256 loanId) external payable nonReentrant {
    Loan storage loan = loans[loanId];
    require(loan.requestedPrincipalToken == address(0), "Loan has ERC20 principal; use liquidateWithERC20");
    _liquidate(loan, loanId, msg.value);   // msg.value is the ceiling; surplus refunded to msg.sender
}

/// ERC20-principal loans. `maxAmount` bounds what the caller will pay; exactly `liquidatorPays`
/// (<= maxAmount) is pulled via transferFrom.
function liquidateWithERC20(uint256 loanId, uint256 maxAmount) external nonReentrant {
    Loan storage loan = loans[loanId];
    require(loan.requestedPrincipalToken != address(0), "Loan has ETH principal; use liquidate");
    _liquidate(loan, loanId, maxAmount);   // maxAmount is the ceiling; exact amount pulled inside
}
```

### Internal core `_liquidate(Loan storage loan, uint256 loanId, uint256 maxPay)`

`maxPay` is the caller-authorized ceiling (ETH `msg.value`, or the ERC20 `maxAmount`).

Order of operations:

1. **Validate loan state**: `require(loan.funded)`, `require(loan.active)`, `require(!loan.repaid)`.
2. **Crystallize interest**: `_accrue(loan)` — so the debt reflects whole-day interest up to now,
   consistent with the repayment path.
3. **Eligibility** — either trigger suffices:
   ```
   bool undercollateralized = getHealthFactor(loanId) < 1e18;
   bool expired = loan.durationSeconds > 0
       && block.timestamp > loan.fundedAt + loan.durationSeconds;
   require(undercollateralized || expired, "Loan is not liquidatable");
   ```
   `getHealthFactor` enforces oracle staleness guards; for expired-but-healthy loans the health factor
   check is skipped via short-circuit if `expired` is true, so a stale price feed cannot block
   liquidation of a genuinely time-defaulted loan.
4. **Compute debt** (same formula as the repayment functions):
   ```
   interestAlreadyPaid  = amountRepaid - principalRepaid
   interestOutstanding  = interestAccrued > interestAlreadyPaid ? interestAccrued - interestAlreadyPaid : 0
   outstandingPrincipal = principalAmount - principalRepaid
   debt                 = interestOutstanding + outstandingPrincipal
   ```
5. **Price collateral and compute seizure + payment** (oracle-priced, with bonus):
   ```
   lockedCollateral = collateralAmount - collateralReleased

   collateralPrice = _getPrice(loan.collateralToken)
   principalPrice  = _getPrice(loan.requestedPrincipalToken)

   // Full-debt seizure target, in collateral token units.
   normalizedDebt   = _normalizeAmount(loan.requestedPrincipalToken, debt)
   debtUSD          = normalizedDebt.mulDiv(principalPrice, 1e18)
   seizeUSD         = debtUSD.mulDiv(10000 + liquidationBonusBps, 10000)
   normalizedSeize  = seizeUSD.mulDiv(1e18, collateralPrice)            // 18-dec collateral units
   targetCollateral = _denormalizeAmount(loan.collateralToken, normalizedSeize)

   if (targetCollateral <= lockedCollateral) {
       // Healthy-but-liquidatable: seize debt+bonus worth, refund the rest, pay full debt.
       seizeCollateral    = targetCollateral
       collateralReturned = lockedCollateral - seizeCollateral
       liquidatorPays     = debt
   } else {
       // Underwater: seize ALL collateral, borrower gets nothing, liquidator pays what the
       // collateral is worth net of the bonus (still profitable), lender eats the shortfall.
       seizeCollateral    = lockedCollateral
       collateralReturned = 0
       // collateralValue / (1 + bonus), expressed in principal-token units.
       lockedUSD          = _normalizeAmount(loan.collateralToken, lockedCollateral).mulDiv(collateralPrice, 1e18)
       payUSD             = lockedUSD.mulDiv(10000, 10000 + liquidationBonusBps)
       normalizedPay      = payUSD.mulDiv(1e18, principalPrice)         // 18-dec principal units
       liquidatorPays     = _denormalizeAmount(loan.requestedPrincipalToken, normalizedPay)
       if (liquidatorPays > debt) liquidatorPays = debt;               // never charge above debt
   }
   ```
   Two small internal helpers are added: `_denormalizeAmount` (inverse of the existing
   `_normalizeAmount`), since the contract currently only normalizes *up* to 18 decimals and here we
   must return values in each token's native decimals.
6. **Collect payment against the ceiling**:
   ```
   require(liquidatorPays <= maxPay, "Exceeds max payment");
   ```
   - **ETH** (`requestedPrincipalToken == address(0)`): the vault already holds `msg.value`; refund
     the surplus `maxPay - liquidatorPays` to `msg.sender` via `_payoutEth` at the end (see payouts).
   - **ERC20**: pull exactly `liquidatorPays` via `safeTransferFrom(msg.sender, this, liquidatorPays)`
     with the fee-on-transfer guard (`balanceBefore`/`received`) identical to `repayLoanWithERC20`.
     Nothing to refund — only the exact amount is pulled.
7. **Protocol fee** — charged only when the loan closes cleanly (lender made whole). Waived when
   underwater because the fee is philosophically a share of lending *profits*; charging it when the
   lender is already taking a loss would reduce their recovery further with no justification:
   ```
   protocolFee  = liquidatorPays == debt ? _protocolFee(interestOutstanding) : 0
   principalPaid = liquidatorPays - (liquidatorPays == debt ? interestOutstanding : liquidatorPays)
   // simplified: when healthy principalPaid = liquidatorPays - interestOutstanding
   //             when underwater principalPaid = 0  (no fee, full payment goes to lender)
   ```
   In the underwater case `liquidatorPays` goes entirely to the lender, maximizing their recovery.
8. **Update state** (loan fully closed regardless of shortfall):
   ```
   loan.amountRepaid      += liquidatorPays
   loan.principalRepaid   += principalPaid       // == principalAmount only when not underwater
   loan.collateralReleased = loan.collateralAmount
   loan.repaid            = true
   loan.active            = false
   loan.collateralLocked  = false
   ```
   Note `principalRepaid` may end below `principalAmount` when underwater — that gap is the lender's
   realized loss and is intentional; the loan is still closed (`repaid = true`).
9. **Payouts** (reusing existing helpers — hybrid direct-then-credit, so a reverting recipient can
   never brick the liquidation):
   - Lender: `liquidatorPays - protocolFee` in the principal token (`_payoutEth` / `_payoutToken`).
   - Treasury: `protocolFee` (emit `ProtocolFeeCollected`) only when > 0 (i.e. healthy close only).
   - Liquidator: `seizeCollateral` of the collateral token (ETH-collateral branch decrements
     `lockedEthCollateral[borrower]` by `lockedCollateral`; ERC20 branch uses `safeTransfer`).
   - Borrower: `collateralReturned` of the collateral token (same branch handling; 0 when underwater).
   - **ETH-principal surplus refund**: `_payoutEth(msg.sender, maxPay - liquidatorPays)` when > 0.
   - The `lockedEthCollateral[borrower]` decrement (ETH collateral) is the *full* `lockedCollateral`,
     done once, since both the seized and returned portions leave the locked pool.
10. **Emit** `LoanLiquidated(loanId, msg.sender, liquidatorPays, seizeCollateral, collateralReturned, block.timestamp)`.

## Edge cases

| Case | Handling |
|------|----------|
| Loan healthy and not expired | Reverts `Loan is not liquidatable`. |
| Loan expired (past `fundedAt + durationSeconds`) | Liquidatable regardless of health factor; same seizure math applies; borrower receives excess collateral if healthy. |
| Ceiling too low | `require(liquidatorPays <= maxPay)` reverts `Exceeds max payment` (slippage guard). |
| Healthy-but-liquidatable | Seize `debt × (1+bonus)` worth of collateral, refund excess to borrower, lender paid full debt. |
| Underwater (collateral worth < debt+bonus) | Seize ALL collateral; borrower gets nothing; liquidator pays `collateralValue/(1+bonus)` (still profits by the bonus, capped at debt); lender receives full `liquidatorPays` (no fee, maximizing recovery); lender realizes `debt − liquidatorPays` as a loss. Loan still closes. |
| ETH surplus | Any `msg.value` above `liquidatorPays` is refunded to the liquidator. |
| Reentrancy | `nonReentrant` on both external entry points. |
| Stale / zero / future oracle price | Inherited from `_getPrice` guards. For the eligibility check, `expired` is evaluated first — a stale feed cannot block liquidation of a time-defaulted loan. Seizure pricing still requires a fresh feed. |
| Reverting lender / treasury / borrower on payout | Hybrid `_payoutEth` / `_payoutToken` fall back to credited pull-payments. |
| Collateral token == principal token | Handled naturally; payouts are independent transfers. |
| ETH vs ERC20 collateral | Existing branch pattern (`collateralToken == address(0)`). |
| Wrong entry point for principal type | Each function guards `requestedPrincipalToken` and points to the other. |

## Tests (`packages/contracts/test/VouchVault.test.ts`)

Replace the two existing stub tests (`liquidate reverts with not implemented ...`) and add:

- **Healthy-but-liquidatable, ETH principal**: liquidator pays full debt, lender credited debt−fee,
  liquidator receives `debt × (1+bonus)` worth of collateral, borrower receives the excess, loan
  marked repaid/inactive, event fields correct.
- **Healthy-but-liquidatable, ERC20 principal** (via `liquidateWithERC20`): same assertions; assert
  exactly `liquidatorPays` is pulled (not `maxAmount`).
- **Bonus math**: assert `seizeCollateral` equals `debtUSD × (1+bonus)` converted to collateral units
  for a known price/threshold setup.
- **Excess to borrower**: over-collateralized-but-liquidatable position returns the remainder.
- **Underwater**: crash price so collateral < debt+bonus. Liquidator receives ALL collateral and pays
  `collateralValue/(1+bonus)` (< debt); borrower gets nothing; lender credited that reduced amount
  (the shortfall `debt − liquidatorPays` is the lender's realized loss); `principalRepaid` ends below
  `principalAmount`; loan still `repaid`/inactive; `amountPaid` in the event equals `liquidatorPays`.
- **ETH surplus refund**: send `msg.value > liquidatorPays`; assert the surplus is returned to the
  liquidator (net of gas).
- **Ceiling too low**: `maxAmount` / `msg.value` below `liquidatorPays` reverts `Exceeds max payment`.
- **Expired-but-healthy**: advance time past `fundedAt + durationSeconds`; assert liquidation
  succeeds, borrower receives excess collateral, lender credited full debt minus fee.
- **Reverts**: healthy non-expired loan (`Loan is not liquidatable`); wrong entry point for principal
  type; already-repaid / inactive / unfunded loan.
- **Protocol fee** routed to treasury on the interest portion for a healthy close; assert fee is
  zero and lender receives the full `liquidatorPays` when underwater.
- **Mismatched decimals** (e.g. 18-dec ETH collateral, 6-dec USDC principal) seizure and payment
  amounts correct.
- `setLiquidationBonusBps`: owner-only, cap enforcement, `LiquidationBonusUpdated` event.
- **Reentrancy**: a malicious collateral/principal token or recipient cannot re-enter.

Follow TDD: write/adjust each test to express the expected behavior, watch it fail against the stub,
then implement.

## Out of scope (documented for issue #19 follow-up)

- Partial liquidation / close-factor.
- Keeper bot wiring (`apps/keeper/main.py` still a stub) — separate task.
- Any frontend surfacing of liquidation events.
