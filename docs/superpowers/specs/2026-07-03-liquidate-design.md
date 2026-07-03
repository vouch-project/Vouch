# Design: `liquidate()` for VouchVault (issue #19)

**Date:** 2026-07-03
**Scope:** Implement the actual liquidation mechanics in `VouchVault.sol`, replacing the
`liquidate: not implemented` stub. Eligibility checking (`getHealthFactor`) and the Chainlink
oracle integration already exist and are unchanged. The contract is **not yet deployed**, so
storage-layout append rules are followed as good practice but versioning/migration is not a concern.

## Goal

Let anyone repay an undercollateralized loan's full debt on behalf of the lender and, in exchange,
seize collateral worth the debt plus a liquidation bonus. Any collateral beyond that is returned to
the borrower. This makes the lender whole and clears the loan.

## Decisions (settled during brainstorming)

1. **Liquidation model — seize debt + bonus, refund the rest (Aave-style).**
   Liquidator repays the full debt; receives collateral worth `debt × (1 + bonus)` priced via the
   existing oracle; excess collateral returns to the borrower. When the position is deep enough
   underwater that collateral is worth less than `debt × (1 + bonus)`, the seizure caps at the
   available collateral and the borrower receives nothing.

2. **Full liquidation only** (no partial / close-factor). The liquidator must repay exactly the
   current debt. Keeps state transitions simple: the loan goes straight to fully-repaid/inactive.

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
    uint256 debtPaid,
    uint256 collateralSeized,
    uint256 collateralReturned,
    uint256 timestamp
);
```

### External entry points

```solidity
/// ETH-principal loans. msg.value must equal the current debt.
function liquidate(uint256 loanId) external payable nonReentrant {
    Loan storage loan = loans[loanId];
    require(loan.requestedPrincipalToken == address(0), "Loan has ERC20 principal; use liquidateWithERC20");
    _liquidate(loan, loanId, msg.value);
}

/// ERC20-principal loans. Pulls `amount` (must equal the current debt) via transferFrom.
function liquidateWithERC20(uint256 loanId, uint256 amount) external nonReentrant {
    Loan storage loan = loans[loanId];
    require(loan.requestedPrincipalToken != address(0), "Loan has ETH principal; use liquidate");
    // Fee-on-transfer guard, identical to repayLoanWithERC20: payouts assume the vault
    // received exactly `amount`.
    uint256 balanceBefore = IERC20(loan.requestedPrincipalToken).balanceOf(address(this));
    IERC20(loan.requestedPrincipalToken).safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = IERC20(loan.requestedPrincipalToken).balanceOf(address(this)) - balanceBefore;
    require(received == amount, "Fee-on-transfer principal not supported");
    _liquidate(loan, loanId, amount);
}
```

### Internal core `_liquidate(Loan storage loan, uint256 loanId, uint256 debtPaid)`

Order of operations:

1. **Validate loan state**: `require(loan.funded)`, `require(loan.active)`, `require(!loan.repaid)`.
2. **Crystallize interest**: `_accrue(loan)` — so the debt reflects whole-day interest up to now,
   consistent with the repayment path.
3. **Eligibility**: `require(getHealthFactor(loanId) < 1e18, "Loan is not undercollateralized")`.
   (`getHealthFactor` re-reads the same crystallized state and enforces the oracle staleness guards.)
4. **Compute debt** (same formula as the repayment functions):
   ```
   interestAlreadyPaid  = amountRepaid - principalRepaid
   interestOutstanding  = interestAccrued > interestAlreadyPaid ? interestAccrued - interestAlreadyPaid : 0
   outstandingPrincipal = principalAmount - principalRepaid
   debt                 = interestOutstanding + outstandingPrincipal
   require(debtPaid == debt, "Payment must equal debt");
   ```
5. **Compute seizure** (oracle-priced, with bonus, capped):
   ```
   lockedCollateral = collateralAmount - collateralReleased

   collateralPrice = _getPrice(loan.collateralToken)
   principalPrice  = _getPrice(loan.requestedPrincipalToken)

   normalizedDebt = _normalizeAmount(loan.requestedPrincipalToken, debt)
   debtUSD        = normalizedDebt.mulDiv(principalPrice, 1e18)
   seizeUSD       = debtUSD.mulDiv(10000 + liquidationBonusBps, 10000)

   // Convert seizeUSD -> collateral token units, then de-normalize back to the token's decimals.
   normalizedSeize = seizeUSD.mulDiv(1e18, collateralPrice)      // 18-dec collateral units
   seizeCollateral = _denormalizeAmount(loan.collateralToken, normalizedSeize)
   if (seizeCollateral > lockedCollateral) seizeCollateral = lockedCollateral   // underwater cap

   collateralReturned = lockedCollateral - seizeCollateral       // excess back to borrower
   ```
   A small internal helper `_denormalizeAmount` (inverse of `_normalizeAmount`) is added, since the
   contract currently only normalizes *up* to 18 decimals and here we must go back to the collateral
   token's native decimals to transfer the right amount.
6. **Update state** (loan fully closed):
   ```
   loan.amountRepaid    += debtPaid
   loan.principalRepaid  = loan.principalAmount
   loan.collateralReleased = loan.collateralAmount
   loan.repaid           = true
   loan.active           = false
   loan.collateralLocked = false
   ```
7. **Payouts** (reusing existing helpers — hybrid direct-then-credit, so a reverting recipient can
   never brick the liquidation):
   - Protocol fee on the interest portion: `protocolFee = _protocolFee(interestOutstanding)`.
   - Lender: `debtPaid - protocolFee` in the principal token (`_payoutEth` / `_payoutToken`).
   - Treasury: `protocolFee` (emit `ProtocolFeeCollected`).
   - Liquidator: `seizeCollateral` of the collateral token (ETH branch decrements
     `lockedEthCollateral[borrower]` by `lockedCollateral`; ERC20 branch uses `safeTransfer`).
   - Borrower: `collateralReturned` of the collateral token (same branch handling).
   - The `lockedEthCollateral[borrower]` decrement (when collateral is ETH) is the *full*
     `lockedCollateral`, done once, since both the seized and returned portions leave the locked pool.
8. **Emit** `LoanLiquidated(loanId, msg.sender, debtPaid, seizeCollateral, collateralReturned, block.timestamp)`.

## Edge cases

| Case | Handling |
|------|----------|
| Loan healthy (HF ≥ 1e18) | Reverts `Loan is not undercollateralized`. |
| Wrong payment amount | `require(debtPaid == debt)` reverts. |
| Deeply underwater (collateral worth < debt+bonus) | `seizeCollateral` caps at `lockedCollateral`; borrower gets nothing; liquidator still pays full debt (rational liquidators self-select — accepted for this reputation-backed protocol). |
| Reentrancy | `nonReentrant` on both external entry points. |
| Stale / zero / future oracle price | Inherited from `_getPrice` guards via `getHealthFactor` and the seizure pricing. |
| Reverting lender / treasury / borrower on payout | Hybrid `_payoutEth` / `_payoutToken` fall back to credited pull-payments. |
| Collateral token == principal token | Handled naturally; payouts are independent transfers. |
| ETH vs ERC20 collateral | Existing branch pattern (`collateralToken == address(0)`). |
| Wrong entry point for principal type | Each function guards `requestedPrincipalToken` and points to the other. |

## Tests (`packages/contracts/test/VouchVault.test.ts`)

Replace the two existing stub tests (`liquidate reverts with not implemented ...`) and add:

- Successful **ETH-principal** liquidation: lender credited debt−fee, liquidator receives seized
  collateral, borrower receives excess, loan marked repaid/inactive, event fields correct.
- Successful **ERC20-principal** liquidation (via `liquidateWithERC20`): same assertions.
- **Bonus math**: assert `seizeCollateral` equals `debtUSD × (1+bonus)` converted to collateral
  units for a known price/threshold setup.
- **Excess to borrower**: over-collateralized-but-liquidatable position returns the remainder.
- **Underwater cap**: crash price so collateral < debt+bonus; liquidator gets all collateral,
  borrower gets nothing, lender still credited full debt.
- **Reverts**: healthy loan; wrong `debtPaid`/`msg.value`; wrong entry point for principal type;
  already-repaid / inactive loan.
- **Protocol fee** routed to treasury on the interest portion.
- **Mismatched decimals** (e.g. 18-dec ETH collateral, 6-dec USDC principal) seizure amount correct.
- `setLiquidationBonusBps`: owner-only, cap enforcement, `LiquidationBonusUpdated` event.
- **Reentrancy**: a malicious collateral/principal token or recipient cannot re-enter.

Follow TDD: write/adjust each test to express the expected behavior, watch it fail against the stub,
then implement.

## Out of scope (documented for issue #19 follow-up)

- Partial liquidation / close-factor.
- Keeper bot wiring (`apps/keeper/main.py` still a stub) — separate task.
- Any frontend surfacing of liquidation events.
