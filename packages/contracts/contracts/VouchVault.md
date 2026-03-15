# VouchVault Smart Contract Documentation

## Overview

VouchVault is a lending vault contract for the Vouch protocol. It allows users to deposit collateral and create loans, with robust validation and event tracking.

## Contract: VouchVault

### Public Functions

#### deposit()

- **Description:** Deposit ETH into the vault.
- **Inputs:** None (payable)
- **Outputs:** None
- **Events:** Deposited(address user, uint256 amount)
- **Usage:**
  - Call with a positive ETH value.

#### withdraw(uint256 amount)

- **Description:** Withdraw ETH from your deposit balance.
- **Inputs:**
  - `amount` (uint256): Amount to withdraw
- **Outputs:** None
- **Events:** Withdrawn(address user, uint256 amount)
- **Usage:**
  - Can only withdraw up to your deposited balance.

#### createLoan(uint256 minCollateral)

- **Description:** Create a new loan by depositing at least `minCollateral` ETH as collateral.
- **Inputs:**
  - `minCollateral` (uint256): Minimum required collateral (in wei)
- **Outputs:** None
- **Events:** LoanCreated(uint256 loanId, address borrower, uint256 collateralAmount)
- **Usage:**
  - Call with a payable ETH value >= `minCollateral`.
  - Collateral is tracked as a deposit and associated with a new loan.

#### getLoan(uint256 loanId)

- **Description:** Get details of a loan by its ID.
- **Inputs:**
  - `loanId` (uint256): The loan ID
- **Outputs:**
  - `borrower` (address)
  - `collateralAmount` (uint256)
  - `createdAt` (uint256)
  - `active` (bool)

### Events

- **Deposited(address user, uint256 amount)**
- **Withdrawn(address user, uint256 amount)**
- **LoanCreated(uint256 loanId, address borrower, uint256 collateralAmount)**

## Usage Guidelines

- Always check event logs for confirmation of deposits, withdrawals, and loan creation.
- Collateral is tracked as part of the user's deposit balance.
- Only the borrower can withdraw their deposit.
- Loans are uniquely identified by an incrementing loanId.

## Testing

- The contract is tested for typical and edge cases, including:
  - Successful loan creation
  - Insufficient collateral
  - Zero collateral

## Integration

- Interact with the contract using ethers.js, web3.js, or similar tools.
- See the test file for usage examples.
