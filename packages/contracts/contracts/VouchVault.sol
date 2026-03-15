// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VouchVault
/// @notice Placeholder lending vault contract for the Vouch protocol

/// @notice Lending vault contract for the Vouch protocol supporting collateralized loans
contract VouchVault {
    struct Loan {
        address borrower;
        uint256 collateralAmount;
        uint256 createdAt;
        bool active;
    }

    mapping(address => uint256) public deposits;
    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 collateralAmount);

    function deposit() external payable {
        require(msg.value > 0, "Must deposit > 0");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Create a new loan by depositing collateral
    /// @dev Emits LoanCreated event on success
    function createLoan() external payable {
        require(msg.value > 0, "Collateral must be > 0");

        // Track collateral as a deposit
        deposits[msg.sender] += msg.value;

        // Create and store the loan
        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralAmount: msg.value,
            createdAt: block.timestamp,
            active: true
        });
        emit LoanCreated(nextLoanId, msg.sender, msg.value);
        nextLoanId++;
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        deposits[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    function balanceOf(address user) external view returns (uint256) {
        return deposits[user];
    }
    /// @notice Get details of a loan by ID
    /// @param loanId The ID of the loan
    /// @return borrower, collateralAmount, createdAt, active
    function getLoan(uint256 loanId) external view returns (address, uint256, uint256, bool) {
        Loan memory loan = loans[loanId];
        return (loan.borrower, loan.collateralAmount, loan.createdAt, loan.active);
    }
}
