// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title VouchVault (Upgradeable)
/// @notice Lending vault contract for the Vouch protocol supporting collateralized loans
contract VouchVault is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;
    
    struct Loan {
        address borrower;
        address collateralToken;  // address(0) = native ETH
        uint256 collateralAmount;
        uint256 createdAt;
        bool active;
        bool collateralLocked;
        // V2 additions — appended to preserve storage layout
        address lender;
        uint256 principalAmount;
        bool funded;
        uint256 fundedAt;
        // V3 additions — appended to preserve storage layout
        address requestedPrincipalToken;  // token borrower wants to receive
        uint256 requestedPrincipalAmount; // amount borrower wants to receive
        // V4 additions — appended to preserve storage layout
        uint16 interestRateBps;      // simple interest rate in basis points (e.g. 500 = 5%)
        uint256 durationSeconds;     // loan term in seconds (0 = no deadline)
        bool repaid;                 // true once the loan has been fully repaid
        uint256 amountRepaid;        // cumulative debt repaid so far (principal token units)
        uint256 collateralReleased;  // cumulative collateral already returned to borrower
    }

    // --- State Variables ---
    // IMPORTANT: Never reorder these in future versions (V2, V3)
    mapping(address => uint256) public deposits;
    mapping(uint256 => Loan) public loans;         // single source of truth for all loan/collateral data
    uint256 public nextLoanId;
    mapping(address => uint256) public lockedEthCollateral; // per-borrower ETH aggregate

    // --- Events ---
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event LoanCreated(
        uint256 indexed loanId,
        address indexed borrower,
        address collateralToken,
        uint256 collateralAmount,
        address requestedPrincipalToken,
        uint256 requestedPrincipalAmount,
        uint256 timestamp
    );

    event LoanFunded(
        uint256 indexed loanId,
        address indexed lender,
        address indexed borrower,
        uint256 principalAmount,
        uint256 timestamp
    );

    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 principalAmount,
        uint256 interestAmount,
        uint256 totalRepaid,
        uint256 timestamp
    );

    event LoanPartiallyRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 paymentAmount,
        uint256 collateralReleased,
        uint256 totalRepaidSoFar,
        uint256 totalDue,
        uint256 timestamp
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents the implementation contract from being initialized directly
        _disableInitializers();
    }

    /**
     * @dev Replaces the constructor. 
     * @param initialOwner The address that will have permission to upgrade the contract.
     */
    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        // __UUPSUpgradeable_init() removed: not required in latest OpenZeppelin
    }

    /**
     * @dev Required by UUPSUpgradeable to restrict who can upgrade the contract.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // --- Logic Functions ---

    function deposit() external payable {
        require(msg.value > 0, "Must deposit > 0");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Create a new loan by depositing ETH collateral
    /// @param principalToken   The token the borrower wants to receive (address(0) = native ETH)
    /// @param principalAmount  The amount the borrower wants to receive
    /// @param interestRateBps  Simple interest rate in basis points (e.g. 500 = 5%); 0 = interest-free
    /// @param durationSeconds  Loan term in seconds; 0 = no deadline
    function createLoan(
        address principalToken,
        uint256 principalAmount,
        uint16 interestRateBps,
        uint256 durationSeconds
    ) external payable {
        require(msg.value > 0, "Collateral must be > 0");
        require(principalAmount > 0, "Principal amount must be > 0");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");

        // Collateral is tracked separately from withdrawable deposits.
        lockedEthCollateral[msg.sender] += msg.value;

        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralToken: address(0),
            collateralAmount: msg.value,
            createdAt: block.timestamp,
            active: true,
            collateralLocked: true,
            lender: address(0),
            principalAmount: 0,
            funded: false,
            fundedAt: 0,
            requestedPrincipalToken: principalToken,
            requestedPrincipalAmount: principalAmount,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            repaid: false,
            amountRepaid: 0,
            collateralReleased: 0
        });

        emit LoanCreated(nextLoanId, msg.sender, address(0), msg.value, principalToken, principalAmount, block.timestamp);
        nextLoanId++;
    }

    /// @notice Create a new loan by depositing ERC20 collateral
    /// @param token            The ERC20 token to use as collateral
    /// @param amount           The amount of collateral to deposit
    /// @param principalToken   The token the borrower wants to receive (address(0) = native ETH)
    /// @param principalAmount  The amount the borrower wants to receive
    /// @param interestRateBps  Simple interest rate in basis points (e.g. 500 = 5%); 0 = interest-free
    /// @param durationSeconds  Loan term in seconds; 0 = no deadline
    function createLoanWithERC20(
        address token,
        uint256 amount,
        address principalToken,
        uint256 principalAmount,
        uint16 interestRateBps,
        uint256 durationSeconds
    ) external {
        require(amount > 0, "Collateral must be > 0");
        require(token != address(0), "Invalid token address");
        require(principalAmount > 0, "Principal amount must be > 0");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");

        // Transfer tokens from user to this vault (SafeERC20 handles non-compliant tokens)
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralToken: token,
            collateralAmount: amount,
            createdAt: block.timestamp,
            active: true,
            collateralLocked: true,
            lender: address(0),
            principalAmount: 0,
            funded: false,
            fundedAt: 0,
            requestedPrincipalToken: principalToken,
            requestedPrincipalAmount: principalAmount,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            repaid: false,
            amountRepaid: 0,
            collateralReleased: 0
        });

        emit LoanCreated(nextLoanId, msg.sender, token, amount, principalToken, principalAmount, block.timestamp);
        nextLoanId++;
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        
        deposits[msg.sender] -= amount;
        
        // Safety: use call instead of transfer to avoid gas limit issues
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH Transfer failed");
        
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Repay some or all of a funded ETH-principal loan.
     * @dev    Accepts any msg.value between 1 wei and the remaining balance (totalDue - amountRepaid).
     *         Each payment proportionally releases collateral: floor(collateralAmount * payment / totalDue).
     *         On the final payment, any dust left from rounding is also returned so all collateral
     *         is eventually recovered. Interest is a flat rate on the original principal.
     * @param loanId The ID of the loan to repay.
     */
    function repayLoan(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(!loan.repaid, "Loan already repaid");
        require(loan.active, "Loan is not active");
        require(loan.funded, "Loan is not funded");
        require(msg.sender == loan.borrower, "Only borrower can repay");
        require(loan.requestedPrincipalToken == address(0), "Loan has ERC20 principal; use repayLoanWithERC20");
        require(msg.value > 0, "Payment must be > 0");

        uint256 totalDue = loan.principalAmount + (loan.principalAmount * loan.interestRateBps) / 10000;
        uint256 remaining = totalDue - loan.amountRepaid;
        require(msg.value <= remaining, "Payment exceeds amount owed");

        loan.amountRepaid += msg.value;
        bool fullRepayment = loan.amountRepaid == totalDue;

        // On the final payment return all remaining collateral to eliminate rounding dust;
        // otherwise release proportionally.
        uint256 collateralToRelease = fullRepayment
            ? loan.collateralAmount - loan.collateralReleased
            : (loan.collateralAmount * msg.value) / totalDue;

        loan.collateralReleased += collateralToRelease;

        if (fullRepayment) {
            loan.repaid = true;
            loan.active = false;
            loan.collateralLocked = false;
        }

        if (loan.collateralToken == address(0)) {
            lockedEthCollateral[loan.borrower] -= collateralToRelease;
        }

        // State fully updated — now do external calls
        (bool lenderOk, ) = payable(loan.lender).call{value: msg.value}("");
        require(lenderOk, "ETH transfer to lender failed");

        if (collateralToRelease > 0) {
            (bool borrowerOk, ) = payable(loan.borrower).call{value: collateralToRelease}("");
            require(borrowerOk, "ETH collateral return failed");
        }

        if (fullRepayment) {
            uint256 interest = (loan.principalAmount * loan.interestRateBps) / 10000;
            emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.principalAmount, interest, totalDue, block.timestamp);
        } else {
            emit LoanPartiallyRepaid(loanId, loan.borrower, msg.value, collateralToRelease, loan.amountRepaid, totalDue, block.timestamp);
        }
    }

    /**
     * @notice Repay some or all of a funded ERC20-principal loan.
     * @dev    The borrower must approve this contract for at least `amount` of the principal token
     *         before calling. Collateral is released proportionally each payment and returned in its
     *         original form (ETH or ERC20). On the final payment, any rounding dust is also returned.
     * @param loanId  The ID of the loan to repay.
     * @param amount  The token amount to repay this call (must be > 0 and <= remaining balance).
     */
    function repayLoanWithERC20(uint256 loanId, uint256 amount) external {
        Loan storage loan = loans[loanId];
        require(!loan.repaid, "Loan already repaid");
        require(loan.active, "Loan is not active");
        require(loan.funded, "Loan is not funded");
        require(msg.sender == loan.borrower, "Only borrower can repay");
        require(loan.requestedPrincipalToken != address(0), "Loan has ETH principal; use repayLoan");
        require(amount > 0, "Payment must be > 0");

        uint256 totalDue = loan.principalAmount + (loan.principalAmount * loan.interestRateBps) / 10000;
        uint256 remaining = totalDue - loan.amountRepaid;
        require(amount <= remaining, "Payment exceeds amount owed");

        loan.amountRepaid += amount;
        bool fullRepayment = loan.amountRepaid == totalDue;

        uint256 collateralToRelease = fullRepayment
            ? loan.collateralAmount - loan.collateralReleased
            : (loan.collateralAmount * amount) / totalDue;

        loan.collateralReleased += collateralToRelease;

        if (fullRepayment) {
            loan.repaid = true;
            loan.active = false;
            loan.collateralLocked = false;
        }

        // Pull payment tokens from borrower and forward to lender
        IERC20(loan.requestedPrincipalToken).safeTransferFrom(msg.sender, loan.lender, amount);

        if (collateralToRelease > 0) {
            if (loan.collateralToken == address(0)) {
                lockedEthCollateral[loan.borrower] -= collateralToRelease;
                (bool ok, ) = payable(loan.borrower).call{value: collateralToRelease}("");
                require(ok, "ETH collateral return failed");
            } else {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, collateralToRelease);
            }
        }

        if (fullRepayment) {
            uint256 interest = (loan.principalAmount * loan.interestRateBps) / 10000;
            emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.principalAmount, interest, totalDue, block.timestamp);
        } else {
            emit LoanPartiallyRepaid(loanId, loan.borrower, amount, collateralToRelease, loan.amountRepaid, totalDue, block.timestamp);
        }
    }

    /**
     * @notice Fund an active ETH-principal loan by sending exactly the requested amount to the borrower.
     * @dev Only one lender may fund a given loan. Funds are transferred immediately to the
     *      borrower; nothing is held in escrow. `msg.value` must equal the borrower's
     *      `requestedPrincipalAmount`, and the loan's `requestedPrincipalToken` must be
     *      `address(0)` (i.e. match native ETH). For ERC20-principal loans use
     *      `fundLoanWithERC20`.
     * @param loanId  The ID of the loan to fund (must be active and not yet funded).
     *
     * Requirements:
     * - `loanId` must refer to an active loan (`loan.active == true`).
     * - The loan must not already be funded.
     * - The lender cannot be the borrower.
     * - `loan.requestedPrincipalToken` must be `address(0)` (native ETH).
     * - `msg.value` must equal `loan.requestedPrincipalAmount`.
     *
     * Emits a {LoanFunded} event.
     */
    function fundLoan(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(!loan.funded, "Loan already funded");
        require(msg.sender != loan.borrower, "Borrower cannot fund own loan");
        require(loan.requestedPrincipalToken == address(0), "Token does not match requested principal token");
        require(msg.value == loan.requestedPrincipalAmount, "msg.value must equal requested principal amount");

        loan.lender = msg.sender;
        loan.principalAmount = loan.requestedPrincipalAmount;
        loan.funded = true;
        loan.fundedAt = block.timestamp;

        // Transfer principal directly to the borrower.
        (bool success, ) = payable(loan.borrower).call{value: loan.requestedPrincipalAmount}("");
        require(success, "ETH transfer to borrower failed");

        emit LoanFunded(loanId, msg.sender, loan.borrower, loan.requestedPrincipalAmount, block.timestamp);
    }

    /// @notice Fund a loan with an ERC20 principal token
    /// @param loanId The ID of the loan to fund
    /// @param token  The ERC20 token address to send as principal (must match requestedPrincipalToken)
    /// @param amount The amount of tokens to send (must match requestedPrincipalAmount)
    function fundLoanWithERC20(uint256 loanId, address token, uint256 amount) external {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(!loan.funded, "Loan already funded");
        require(msg.sender != loan.borrower, "Borrower cannot fund own loan");
        require(loan.requestedPrincipalToken != address(0), "Loan requires native ETH principal; use fundLoan");
        require(amount > 0, "Funding amount must be > 0");
        require(token == loan.requestedPrincipalToken, "Token does not match requested principal token");
        require(amount == loan.requestedPrincipalAmount, "Amount does not match requested principal amount");

        loan.lender = msg.sender;
        loan.principalAmount = amount;
        loan.funded = true;
        loan.fundedAt = block.timestamp;

        // Transfer principal directly to the borrower.
        IERC20(token).safeTransferFrom(msg.sender, loan.borrower, amount);

        emit LoanFunded(loanId, msg.sender, loan.borrower, amount, block.timestamp);
    }

    // --- View Functions ---

    function balanceOf(address user) external view returns (uint256) {
        return deposits[user];
    }

    function lockedBalanceOf(address user) external view returns (uint256) {
        return lockedEthCollateral[user];
    }

    function loanLockedBalanceOf(uint256 loanId) external view returns (uint256) {
        Loan memory loan = loans[loanId];
        // ETH-only; ERC20 collateral has no common unit — use getLoanLockedCollateral instead
        return loan.collateralToken == address(0) ? loan.collateralAmount : 0;
    }

    function getLoanLockedCollateral(uint256 loanId) external view returns (
        address collateralToken,
        uint256 collateralAmount,
        bool locked
    ) {
        Loan memory loan = loans[loanId];
        return (loan.collateralToken, loan.collateralAmount, loan.collateralLocked);
    }

    function getLoan(uint256 loanId) external view returns (
        address borrower,
        address collateralToken,
        uint256 collateralAmount,
        uint256 createdAt,
        bool active
    ) {
        Loan memory loan = loans[loanId];
        return (
            loan.borrower,
            loan.collateralToken,
            loan.collateralAmount,
            loan.createdAt,
            loan.active
        );
    }

    /**
     * @notice Returns repayment-related details for a loan.
     * @return interestRateBps  Agreed interest rate in basis points.
     * @return durationSeconds  Agreed loan duration in seconds (0 = no deadline).
     * @return repaid           Whether the loan has been fully repaid.
     * @return totalDue         Principal + interest owed (0 if not funded).
     * @return amountRepaid     Cumulative amount repaid so far.
     * @return remaining        Amount still outstanding.
     */
    function getRepaymentDetails(uint256 loanId) external view returns (
        uint16 interestRateBps,
        uint256 durationSeconds,
        bool repaid,
        uint256 totalDue,
        uint256 amountRepaid,
        uint256 remaining
    ) {
        Loan memory loan = loans[loanId];
        uint256 interest = (loan.principalAmount * loan.interestRateBps) / 10000;
        uint256 due = loan.funded ? loan.principalAmount + interest : 0;
        return (
            loan.interestRateBps,
            loan.durationSeconds,
            loan.repaid,
            due,
            loan.amountRepaid,
            due > loan.amountRepaid ? due - loan.amountRepaid : 0
        );
    }

    /**
     * @notice Returns funding details for a given loan.
     * @param loanId The loan to query.
     * @return lender          Address that funded the loan (zero address if unfunded).
     * @return principalAmount ETH amount sent by the lender.
     * @return funded          Whether the loan has been funded.
     * @return fundedAt        Timestamp of funding (0 if unfunded).
     */
    function getFundingDetails(uint256 loanId) external view returns (
        address lender,
        uint256 principalAmount,
        bool funded,
        uint256 fundedAt
    ) {
        Loan memory loan = loans[loanId];
        return (loan.lender, loan.principalAmount, loan.funded, loan.fundedAt);
    }
}
