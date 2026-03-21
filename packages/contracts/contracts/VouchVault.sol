// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IERC20.sol";

/// @title VouchVault (Upgradeable)
/// @notice Lending vault contract for the Vouch protocol supporting collateralized loans
contract VouchVault is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    
    struct Loan {
        address borrower;
        address collateralToken;
        uint256 collateralAmount;
        uint256 createdAt;
        bool active;
    }

    // --- State Variables ---
    // IMPORTANT: Never reorder these in future versions (V2, V3)
    mapping(address => uint256) public deposits;
    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId;

    // --- Events ---
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event LoanCreated(
        uint256 indexed loanId, 
        address indexed borrower, 
        address collateralToken, 
        uint256 collateralAmount,
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
    function createLoan() external payable {
        require(msg.value > 0, "Collateral must be > 0");

        // Track collateral as a deposit
        deposits[msg.sender] += msg.value;

        // Create and store the loan
        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralToken: address(0), // address(0) represents Native ETH
            collateralAmount: msg.value,
            createdAt: block.timestamp,
            active: true
        });

        emit LoanCreated(nextLoanId, msg.sender, address(0), msg.value, block.timestamp);
        nextLoanId++;
    }

    /// @notice Create a new loan by depositing ERC20 collateral
    function createLoanWithERC20(address token, uint256 amount) external {
        require(amount > 0, "Collateral must be > 0");
        require(token != address(0), "Invalid token address");

        // Transfer tokens from user to this vault
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");

        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralToken: token,
            collateralAmount: amount,
            createdAt: block.timestamp,
            active: true
        });

        emit LoanCreated(nextLoanId, msg.sender, token, amount, block.timestamp);
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

    // --- View Functions ---

    function balanceOf(address user) external view returns (uint256) {
        return deposits[user];
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
}
