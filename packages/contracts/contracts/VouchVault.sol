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
    /// @param principalToken  The token the borrower wants to receive (address(0) = native ETH)
    /// @param principalAmount The amount the borrower wants to receive
    function createLoan(address principalToken, uint256 principalAmount) external payable {
        require(msg.value > 0, "Collateral must be > 0");
        require(principalAmount > 0, "Principal amount must be > 0");

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
            requestedPrincipalAmount: principalAmount
        });

        emit LoanCreated(nextLoanId, msg.sender, address(0), msg.value, principalToken, principalAmount, block.timestamp);
        nextLoanId++;
    }

    /// @notice Create a new loan by depositing ERC20 collateral
    /// @param token           The ERC20 token to use as collateral
    /// @param amount          The amount of collateral to deposit
    /// @param principalToken  The token the borrower wants to receive (address(0) = native ETH)
    /// @param principalAmount The amount the borrower wants to receive
    function createLoanWithERC20(address token, uint256 amount, address principalToken, uint256 principalAmount) external {
        require(amount > 0, "Collateral must be > 0");
        require(token != address(0), "Invalid token address");
        require(principalAmount > 0, "Principal amount must be > 0");

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
            requestedPrincipalAmount: principalAmount
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

    function releaseLoanCollateral(uint256 /*loanId*/) external pure {
        revert("Collateral release disabled");
    }

    /**
     * @notice Fund an active loan by sending the principal amount directly to the borrower.
     * @dev Only one lender may fund a given loan. Funds are transferred immediately to the
     *      borrower; nothing is held in escrow. The caller must send exactly the amount they
     *      wish to lend as `msg.value`.
     * @param loanId  The ID of the loan to fund (must be active and not yet funded).
     *
     * Requirements:
     * - `loanId` must refer to an active loan (`loan.active == true`).
     * - The loan must not already be funded.
     * - The lender cannot be the borrower.
     * - `msg.value` must be greater than 0.
     *
     * Emits a {LoanFunded} event.
     */
    function fundLoan(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(!loan.funded, "Loan already funded");
        require(msg.sender != loan.borrower, "Borrower cannot fund own loan");
        require(msg.value > 0, "Funding amount must be > 0");

        loan.lender = msg.sender;
        loan.principalAmount = msg.value;
        loan.funded = true;
        loan.fundedAt = block.timestamp;

        // Transfer principal directly to the borrower.
        (bool success, ) = payable(loan.borrower).call{value: msg.value}("");
        require(success, "ETH transfer to borrower failed");

        emit LoanFunded(loanId, msg.sender, loan.borrower, msg.value, block.timestamp);
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
