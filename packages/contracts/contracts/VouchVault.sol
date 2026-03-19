// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VouchVault
/// @notice Placeholder lending vault contract for the Vouch protocol

/// @notice Lending vault contract for the Vouch protocol supporting collateralized loans
import "./IERC20.sol";

contract VouchVault {
    struct Loan {
        address borrower;
        address collateralToken;
        uint256 collateralAmount;
        uint256 createdAt;
        bool active;
    }

    mapping(address => uint256) public deposits;
    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event LoanCreated(uint256 indexed loanId, address indexed borrower, address collateralToken, uint256 collateralAmount);

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
            collateralToken: address(0),
            collateralAmount: msg.value,
            createdAt: block.timestamp,
            active: true
        });
        emit LoanCreated(nextLoanId, msg.sender, address(0), msg.value);
        nextLoanId++;
    }

    function createLoanWithERC20(address token, uint256 amount) external {
        require(amount > 0, "Collateral must be > 0");
        require(token != address(0), "Invalid token address");
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");
        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralToken: token,
            collateralAmount: amount,
            createdAt: block.timestamp,
            active: true
        });
        emit LoanCreated(nextLoanId, msg.sender, token, amount);
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
    function getLoan(uint256 loanId) external view returns (address, address, uint256, uint256, bool) {
        Loan memory loan = loans[loanId];
        return (loan.borrower, loan.collateralToken, loan.collateralAmount, loan.createdAt, loan.active);
    }
}
