// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LendingPool
 * @notice Core lending pool contract for Vouch P2P lending platform
 * @dev Handles loan creation, matching, repayment, and liquidation
 */
contract LendingPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Loan status enum
    enum LoanStatus {
        Pending,
        Active,
        Repaid,
        Liquidated,
        Defaulted
    }

    // Loan struct
    struct Loan {
        uint256 id;
        address borrower;
        address lender;
        address collateralToken;
        address loanToken;
        uint256 collateralAmount;
        uint256 loanAmount;
        uint256 interestRate; // In basis points (e.g., 500 = 5%)
        uint256 duration; // In seconds
        uint256 startTime;
        uint256 endTime;
        LoanStatus status;
    }

    // State variables
    mapping(uint256 => Loan) public loans;
    uint256 public loanCounter;
    uint256 public constant LIQUIDATION_THRESHOLD = 8000; // 80% in basis points
    uint256 public constant LIQUIDATION_BONUS = 500; // 5% bonus for liquidators

    // Events
    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 amount);
    event LoanMatched(uint256 indexed loanId, address indexed lender);
    event LoanRepaid(uint256 indexed loanId, uint256 amount);
    event LoanLiquidated(uint256 indexed loanId, address indexed liquidator);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Create a new loan request
     * @param collateralToken Address of the collateral token
     * @param loanToken Address of the loan token
     * @param collateralAmount Amount of collateral to deposit
     * @param loanAmount Amount requested to borrow
     * @param interestRate Interest rate in basis points
     * @param duration Loan duration in seconds
     */
    function createLoanRequest(
        address collateralToken,
        address loanToken,
        uint256 collateralAmount,
        uint256 loanAmount,
        uint256 interestRate,
        uint256 duration
    ) external nonReentrant returns (uint256) {
        require(collateralAmount > 0, "Collateral amount must be > 0");
        require(loanAmount > 0, "Loan amount must be > 0");
        require(duration > 0, "Duration must be > 0");

        // Transfer collateral from borrower
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);

        // Create loan
        loanCounter++;
        loans[loanCounter] = Loan({
            id: loanCounter,
            borrower: msg.sender,
            lender: address(0),
            collateralToken: collateralToken,
            loanToken: loanToken,
            collateralAmount: collateralAmount,
            loanAmount: loanAmount,
            interestRate: interestRate,
            duration: duration,
            startTime: 0,
            endTime: 0,
            status: LoanStatus.Pending
        });

        emit LoanCreated(loanCounter, msg.sender, loanAmount);
        return loanCounter;
    }

    /**
     * @notice Fund a loan request (lender provides liquidity)
     * @param loanId ID of the loan to fund
     */
    function fundLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Pending, "Loan not in pending status");
        require(loan.borrower != msg.sender, "Borrower cannot fund own loan");

        // Transfer loan amount from lender to borrower
        IERC20(loan.loanToken).safeTransferFrom(msg.sender, loan.borrower, loan.loanAmount);

        // Update loan
        loan.lender = msg.sender;
        loan.status = LoanStatus.Active;
        loan.startTime = block.timestamp;
        loan.endTime = block.timestamp + loan.duration;

        emit LoanMatched(loanId, msg.sender);
    }

    /**
     * @notice Repay a loan
     * @param loanId ID of the loan to repay
     */
    function repayLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Loan not active");
        require(msg.sender == loan.borrower, "Only borrower can repay");

        // Calculate total repayment (principal + interest)
        uint256 interest = (loan.loanAmount * loan.interestRate) / 10000;
        uint256 totalRepayment = loan.loanAmount + interest;

        // Transfer repayment from borrower to lender
        IERC20(loan.loanToken).safeTransferFrom(msg.sender, loan.lender, totalRepayment);

        // Return collateral to borrower
        IERC20(loan.collateralToken).safeTransfer(loan.borrower, loan.collateralAmount);

        // Update loan status
        loan.status = LoanStatus.Repaid;

        emit LoanRepaid(loanId, totalRepayment);
    }

    /**
     * @notice Liquidate an underwater loan
     * @param loanId ID of the loan to liquidate
     */
    function liquidate(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Loan not active");

        // Check if loan is liquidatable
        require(_isLiquidatable(loanId), "Loan is not liquidatable");

        // Calculate repayment amount
        uint256 interest = (loan.loanAmount * loan.interestRate) / 10000;
        uint256 totalRepayment = loan.loanAmount + interest;

        // Transfer repayment from liquidator to lender
        IERC20(loan.loanToken).safeTransferFrom(msg.sender, loan.lender, totalRepayment);

        // Calculate liquidation bonus
        uint256 bonus = (loan.collateralAmount * LIQUIDATION_BONUS) / 10000;
        uint256 liquidatorCollateral = loan.collateralAmount + bonus;

        // Transfer collateral to liquidator
        IERC20(loan.collateralToken).safeTransfer(msg.sender, liquidatorCollateral);

        // Update loan status
        loan.status = LoanStatus.Liquidated;

        emit LoanLiquidated(loanId, msg.sender);
    }

    /**
     * @notice Get active loan IDs
     * @return Array of active loan IDs
     */
    function getActiveLoanIds() external view returns (uint256[] memory) {
        uint256 activeCount = 0;
        
        // Count active loans
        for (uint256 i = 1; i <= loanCounter; i++) {
            if (loans[i].status == LoanStatus.Active) {
                activeCount++;
            }
        }

        // Populate array
        uint256[] memory activeLoanIds = new uint256[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 1; i <= loanCounter; i++) {
            if (loans[i].status == LoanStatus.Active) {
                activeLoanIds[index] = i;
                index++;
            }
        }

        return activeLoanIds;
    }

    /**
     * @notice Get loan details
     * @param loanId ID of the loan
     * @return Loan struct
     */
    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    /**
     * @notice Check if a loan is liquidatable
     * @param loanId ID of the loan
     * @return Boolean indicating if loan can be liquidated
     */
    function _isLiquidatable(uint256 loanId) internal view returns (bool) {
        Loan storage loan = loans[loanId];
        
        // Simple check: loan past due date
        // In production, would check health factor based on oracle prices
        return block.timestamp > loan.endTime;
    }
}
