# VouchVault Smart Contract Documentation

## Overview

VouchVault is an upgradeable (UUPS proxy pattern) lending vault contract for the Vouch protocol. It supports collateralized loans denominated in either native ETH or ERC20 tokens, with robust validation and event tracking.

## Contract: VouchVault

Inherits: `Initializable`, `OwnableUpgradeable`, `UUPSUpgradeable`

### State Variables

| Variable              | Type                          | Description                                |
| --------------------- | ----------------------------- | ------------------------------------------ |
| `deposits`            | `mapping(address => uint256)` | Withdrawable ETH deposit balance per user  |
| `loans`               | `mapping(uint256 => Loan)`    | Single source of truth for all loan data   |
| `nextLoanId`          | `uint256`                     | Auto-incrementing ID assigned to new loans |
| `lockedEthCollateral` | `mapping(address => uint256)` | Total ETH collateral locked per borrower   |

### Loan Struct

```solidity
struct Loan {
    address borrower;
    address collateralToken;  // address(0) for native ETH
    uint256 collateralAmount;
    uint256 createdAt;
    bool active;
    bool collateralLocked;
}
```

---

### Initializer

#### initialize(address initialOwner)

- **Description:** Replaces the constructor. Must be called once on the proxy after deployment.
- **Inputs:**
  - `initialOwner` (address): Address granted owner privileges (required for upgrades).
- **Access:** Can only be called once (`initializer` modifier).

---

### Write Functions

#### deposit()

- **Description:** Deposit ETH into your withdrawable vault balance.
- **Inputs:** None (payable)
- **Outputs:** None
- **Events:** `Deposited(address indexed user, uint256 amount)`
- **Requirements:** `msg.value > 0`

#### withdraw(uint256 amount)

- **Description:** Withdraw ETH from your withdrawable deposit balance.
- **Inputs:**
  - `amount` (uint256): Amount to withdraw (in wei)
- **Outputs:** None
- **Events:** `Withdrawn(address indexed user, uint256 amount)`
- **Requirements:** Caller must have a sufficient `deposits` balance.
- **Note:** Uses `call` for the ETH transfer to avoid gas limit issues.

#### createLoan(address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint16 interestRateBps, uint256 durationSeconds, uint256 fundWindowSeconds, uint16 liquidationThresholdBps, uint16 maxLtvBps, uint256 expiry, bytes sig)

- **Description:** Create a new loan by depositing collateral (native ETH or an ERC20 token). A single entry point handles both collateral kinds — pass `collateralToken == address(0)` for native ETH, or a token address for ERC20 collateral. ETH collateral is locked (not added to the withdrawable `deposits` balance). ERC20 collateral is transferred in via OpenZeppelin's `SafeERC20`, which supports non-standard tokens that do not return a boolean (e.g. USDT).
- **Inputs:**
  - `collateralToken` (address): Collateral token address; `address(0)` for native ETH.
  - `collateralAmount` (uint256): Amount of ERC20 collateral; ignored for ETH (the sent `msg.value` is used).
  - `principalToken` (address): Token the borrower wants to receive; `address(0)` for native ETH.
  - `principalAmount` (uint256): Amount the borrower wants to receive (must be `> 0`).
  - `interestRateBps` (uint16): Annual interest rate in basis points (e.g. `500` = 5% APR); `0` = interest-free.
  - `durationSeconds` (uint256): Loan term in seconds; caps interest accrual; `0` = no deadline / no time-based interest.
  - `fundWindowSeconds` (uint256): Seconds from creation during which the loan may be funded (must be `> 0`).
  - `liquidationThresholdBps` (uint16): Maximum LTV in basis points; must be in `(0, 10000]` and must not exceed `maxLtvBps`.
  - `maxLtvBps` (uint16): Backend-attested LTV ceiling for this borrower.
  - `expiry` (uint256): LTV attestation expiry (unix seconds).
  - `sig` (bytes): EIP-712 signature over the LTV attestation from `scoreSigner`.
- **Outputs:** None
- **Events:** `LoanCreated(uint256 indexed loanId, address indexed borrower, address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint256 timestamp)`
- **Requirements:**
  - ETH collateral (`collateralToken == address(0)`): `msg.value > 0`.
  - ERC20 collateral: `msg.value == 0`, `collateralAmount > 0`, and the caller must have approved the vault to spend at least `collateralAmount`. Fee-on-transfer tokens revert (`FeeOnTransferNotSupported`).
- **Note:** `collateralToken` in the event is `address(0)` for ETH loans.

#### releaseLoanCollateral(uint256 loanId)

- **Description:** Collateral release is currently **disabled**. Always reverts.
- **Note:** Reserved for a future upgrade.

---

### View Functions

> **Read helpers live on `VouchVaultLens`.** To keep `VouchVault` under the 24 576-byte
> EVM code-size limit, the convenience read helpers below (plus `getFundingDetails` and
> `getRepaymentDetails`) were moved to a separate, stateless companion contract,
> `VouchVaultLens`, constructed with the vault address. Call them on a lens instance
> (`VouchVaultLens(lensAddress).getRepaymentDetails(loanId)`), not on the vault. The lens reads
> raw loan data via the vault's auto-generated `loans`, `deposits`, and `lockedEthCollateral`
> mapping getters, which remain on `VouchVault`. (`getLoanRaw` was removed to reclaim bytecode —
> the public `loans` mapping already exposes the same struct.) `getHealthFactor` remains callable
> on the vault (the lens also forwards it).

#### balanceOf(address user) → uint256

- Returns the withdrawable ETH deposit balance of `user`.

#### lockedBalanceOf(address user) → uint256

- Returns the total **ETH** collateral locked across all ETH-collateral loans for `user`.
- **ERC20 collateral is not reflected here.** For ERC20-collateral loans, query each loan individually with `getLoanLockedCollateral`.

#### loanLockedBalanceOf(uint256 loanId) → uint256

- Returns the **ETH** collateral locked for a specific ETH-collateral loan.
- Returns `0` for ERC20-collateral loans — use `getLoanLockedCollateral` instead.

#### getLoanLockedCollateral(uint256 loanId) → (address collateralToken, uint256 collateralAmount, bool locked)

- Returns the collateral details and lock status for a given loan.

#### getLoan(uint256 loanId) → (address borrower, address collateralToken, uint256 collateralAmount, uint256 createdAt, bool active)

- Returns the full details of a loan by its ID.

#### getFundingDetails(uint256 loanId) → (address lender, uint256 principalAmount, bool funded, uint256 fundedAt)

- Returns the funding state of a loan.

#### getRepaymentDetails(uint256 loanId) → (uint16 interestRateBps, uint256 durationSeconds, bool repaid, uint256 totalDue, uint256 amountRepaid, uint256 remaining, uint256 fundDeadline)

- Returns repayment progress. `totalDue` includes interest accrued up to the **current block timestamp** (crystallized interest plus pending whole-day accrual on the outstanding principal); once `repaid` it equals the final `amountRepaid`. `remaining = max(totalDue - amountRepaid, 0)`.

---

### Events

- **`Deposited(address indexed user, uint256 amount)`**
- **`Withdrawn(address indexed user, uint256 amount)`**
- **`LoanCreated(uint256 indexed loanId, address indexed borrower, address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint256 timestamp)`**

---

## Signed Orders (EIP-712)

Gasless, off-chain orders let a borrower or lender **sign** their side of a loan without a transaction; the counterparty submits a single on-chain `fill*` call that verifies the signature and settles the loan. The signer commits their asset by pre-approving the vault (ERC20 `approve`) — so the committed asset **must be an ERC20**, never native ETH. The counterparty supplies the other leg (ETH or ERC20) at fill time.

### EIP-712 Domain

- **name:** `Vouch`
- **version:** `1`
- **chainId / verifyingContract:** the connected chain id and the vault (proxy) address.

### Structs

The typed-data field order is significant — it must match the on-chain typehashes exactly.

```solidity
struct SignedLoanRequest {
    address borrower;
    address collateralToken;   // ERC20 only (signer's committed asset)
    uint256 collateralAmount;
    address principalToken;    // ETH (address(0)) or ERC20 (supplied by lender at fill)
    uint256 principalAmount;
    uint16  interestRateBps;
    uint256 durationSeconds;
    uint16  maxLtvBps;
    uint256 nonce;             // random uint256 for digest uniqueness
    uint256 deadline;          // unix seconds; fill reverts once past
}

struct SignedLendOffer {
    address lender;
    address principalToken;    // ERC20 only (signer's committed asset)
    uint256 principalAmount;
    uint16  collateralRatioBps;
    uint16  trustedRatioBps;
    uint16  scoreThreshold;
    uint16  maxLtvBps;
    uint16  interestRateBps;
    uint256 durationSeconds;
    uint256 nonce;
    uint256 deadline;
}
```

### Functions

#### Order digests (EIP-712)

- The order digest is the EIP-712 hash of the struct — the value produced by `TypedDataEncoder.hash(domain, types, value)`. It is used off-chain to key/track an order and on-chain as the consumed-order marker.
- The vault's `hashLoanRequest` / `hashLendOffer` helpers are `internal` (not part of the ABI — omitted to keep the contract under the 24 576-byte limit). Compute the digest **client-side** with `ethers.TypedDataEncoder.hash(domain, types, value)` using the domain and struct field order documented above; it matches what `fill*` / `cancel*` hash internally.

#### fillLoanRequest(SignedLoanRequest req, bytes sig) — payable

- Called by the **lender**. Recovers the signer from `sig`, requires `signer == req.borrower`, checks `deadline`, verifies the digest was not already consumed, and enforces the collateral ratio against `maxLtvBps`.
- Pulls the borrower's ERC20 collateral (pre-approved at sign time) and the lender's principal — ETH via `msg.value` when `principalToken == address(0)`, otherwise ERC20 `transferFrom`. Creates the loan and emits `SignedLoanRequestFilled`.
- Reverts on: ETH collateral (`collateralToken == address(0)`), zero `principalAmount`, wrong signer, expired deadline, already-consumed digest, or collateral below the required ratio.

#### fillLendOffer(SignedLendOffer offer, address collateralToken, uint256 collateralAmount, bytes sig) — payable

- Called by the **borrower**, who supplies `collateralToken` and `collateralAmount` (must satisfy `collateralRatioBps` at current prices). Recovers the signer, requires `signer == offer.lender`, checks `deadline` and the consumed marker.
- Pulls the lender's ERC20 principal (pre-approved) and the borrower's collateral — ETH via `msg.value` when `collateralToken == address(0)`, otherwise ERC20 `transferFrom`. Creates the loan and emits `SignedLendOfferFilled`.
- Reverts on: ETH principal (`principalToken == address(0)`), wrong signer, expired deadline, already-consumed digest, or insufficient collateral. Signed offers fill at the base `collateralRatioBps` (no score attestation is passed at fill).

#### cancelSignedLoanRequest(SignedLoanRequest req) / cancelSignedLendOffer(SignedLendOffer offer)

- The signer (borrower / lender respectively) marks their own order's digest consumed so it can never be filled. Reverts if `msg.sender` is not the signer. Emits `SignedLoanRequestCancelled` / `SignedLendOfferCancelled`.

### Events

- **`SignedLoanRequestFilled(uint256 indexed loanId, bytes32 indexed digest, address indexed borrower, address lender, address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint256 timestamp)`**
- **`SignedLendOfferFilled(uint256 indexed loanId, bytes32 indexed digest, address indexed lender, address borrower, address principalToken, uint256 principalAmount, address collateralToken, uint256 collateralAmount, uint256 timestamp)`**
- **`SignedLoanRequestCancelled(bytes32 indexed digest, address indexed borrower)`**
- **`SignedLendOfferCancelled(bytes32 indexed digest, address indexed lender)`**

> All four signed-order events carry a `Signed` prefix to avoid colliding with the pre-existing `LendOfferCancelled(uint256,address)` event.

---

## Usage Guidelines

- Always check event logs for confirmation of deposits, withdrawals, and loan creation.
- ETH collateral (via `createLoan`) is locked separately from the withdrawable `deposits` balance — it cannot be withdrawn via `withdraw()`. The aggregate is accessible via `VouchVaultLens.lockedBalanceOf` (or the vault's `lockedEthCollateral` mapping getter).
- ERC20 collateral (via `createLoan` with `collateralToken != address(0)`) is **not** tracked in `lockedBalanceOf` or `loanLockedBalanceOf`. Query collateral details per loan using `VouchVaultLens.getLoanLockedCollateral(loanId)`.
- ERC20 collateral requires a prior `approve()` call on the token contract. The vault uses `SafeERC20.safeTransferFrom`, so non-compliant tokens (e.g. those that don't return a boolean) are handled correctly.
- Only the owner can authorize contract upgrades.
- Loans are uniquely identified by an auto-incrementing `loanId` starting at 0.
- `address(0)` as `collateralToken` means the collateral is native ETH.

## Testing

- The contract is tested for typical and edge cases, including:
  - Successful ETH loan creation
  - Successful ERC20 loan creation
  - Zero collateral rejection
  - Deposit and withdrawal flows

## Integration

- Interact with the contract using ethers.js, viem, or similar tools.
- The contract is deployed behind a UUPS proxy — interact with the proxy address, not the implementation.
- See the test file for usage examples.
