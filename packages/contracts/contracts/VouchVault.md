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
