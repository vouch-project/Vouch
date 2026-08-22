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

#### createLoan()

- **Description:** Create a new loan using native ETH as collateral. The sent ETH is locked (not added to the withdrawable `deposits` balance).
- **Inputs:** None (payable)
- **Outputs:** None
- **Events:** `LoanCreated(uint256 indexed loanId, address indexed borrower, address collateralToken, uint256 collateralAmount, uint256 timestamp)`
- **Requirements:** `msg.value > 0`
- **Note:** `collateralToken` in the event will be `address(0)` for ETH loans.

#### createLoanWithERC20(address token, uint256 amount)

- **Description:** Create a new loan using an ERC20 token as collateral. Transfers `amount` of `token` from the caller to the vault using OpenZeppelin's `SafeERC20`, which supports non-standard tokens that do not return a boolean (e.g. USDT).
- **Inputs:**
  - `token` (address): ERC20 token contract address (must not be `address(0)`)
  - `amount` (uint256): Amount of tokens to lock as collateral
- **Outputs:** None
- **Events:** `LoanCreated(uint256 indexed loanId, address indexed borrower, address collateralToken, uint256 collateralAmount, uint256 timestamp)`
- **Requirements:** Caller must have approved the vault to spend at least `amount` of `token`. `amount > 0`.

#### releaseLoanCollateral(uint256 loanId)

- **Description:** Collateral release is currently **disabled**. Always reverts.
- **Note:** Reserved for a future upgrade.

---

### View Functions

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

---

### Events

- **`Deposited(address indexed user, uint256 amount)`**
- **`Withdrawn(address indexed user, uint256 amount)`**
- **`LoanCreated(uint256 indexed loanId, address indexed borrower, address collateralToken, uint256 collateralAmount, uint256 timestamp)`**

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
    address collateralToken;   // ETH (address(0)) or ERC20 (supplied by borrower at fill)
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

#### hashLoanRequest(SignedLoanRequest req) → bytes32 / hashLendOffer(SignedLendOffer offer) → bytes32

- Returns the EIP-712 digest (the same value produced by `TypedDataEncoder.hash(domain, types, value)`). Used off-chain to key/track an order and on-chain as the consumed-order marker.

#### fillLoanRequest(SignedLoanRequest req, bytes sig) — payable

- Called by the **lender**. Recovers the signer from `sig`, requires `signer == req.borrower`, checks `deadline`, verifies the digest was not already consumed, and enforces the collateral ratio against `maxLtvBps`.
- Pulls the borrower's ERC20 collateral (pre-approved at sign time) and the lender's principal — ETH via `msg.value` when `principalToken == address(0)`, otherwise ERC20 `transferFrom`. Creates the loan and emits `SignedLoanRequestFilled`.
- Reverts on: ETH collateral (`collateralToken == address(0)`), zero `principalAmount`, wrong signer, expired deadline, already-consumed digest, or collateral below the required ratio.

#### fillLendOffer(SignedLendOffer offer, uint256 collateralAmount, bytes sig) — payable

- Called by the **borrower**, who chooses `collateralAmount` (must satisfy `collateralRatioBps` at current prices). Recovers the signer, requires `signer == offer.lender`, checks `deadline` and the consumed marker.
- Pulls the lender's ERC20 principal (pre-approved) and the borrower's collateral — ETH via `msg.value` when `collateralToken == address(0)`, otherwise ERC20. Creates the loan and emits `SignedLendOfferFilled`.
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
- ETH collateral (via `createLoan`) is locked separately from the withdrawable `deposits` balance — it cannot be withdrawn via `withdraw()`. The aggregate is accessible via `lockedBalanceOf`.
- ERC20 collateral (via `createLoanWithERC20`) is **not** tracked in `lockedBalanceOf` or `loanLockedBalanceOf`. Query collateral details per loan using `getLoanLockedCollateral(loanId)`.
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
