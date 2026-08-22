// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

/// @title VouchVault (Upgradeable)
/// @notice Lending vault contract for the Vouch protocol supporting collateralized loans
contract VouchVault is Initializable, OwnableUpgradeable, UUPSUpgradeable, EIP712Upgradeable {
    using SafeERC20 for IERC20;
    using Math for uint256;
    using ECDSA for bytes32;
    
    struct Loan {
        // Borrower & collateral
        address borrower;
        address collateralToken;     // address(0) = native ETH
        uint256 collateralAmount;
        bool collateralLocked;
        uint256 collateralReleased;  // cumulative collateral already returned to borrower
        // Lifecycle
        uint256 createdAt;
        bool active;
        bool funded;
        bool repaid;                 // true once the loan has been fully repaid
        uint256 fundDeadline;        // absolute timestamp after which the loan can no longer be funded
        // Lender & principal
        address lender;
        address requestedPrincipalToken;  // token borrower wants to receive
        uint256 requestedPrincipalAmount; // amount borrower wants to receive
        uint256 principalAmount;          // principal actually lent
        uint256 fundedAt;
        // Repayment terms & accounting
        uint16 interestRateBps;      // ANNUAL interest rate in basis points (e.g. 500 = 5% APR), max 10000 = 100%
        uint256 durationSeconds;     // loan term in seconds (0 = no deadline / no time-based interest)
        uint256 amountRepaid;        // cumulative debt repaid so far (principal token units)
        uint256 principalRepaid;     // cumulative principal repaid (interest-first amortization)
        uint256 interestAccrued;     // interest crystallized into the debt up to lastAccrualAt
        uint256 lastAccrualAt;       // timestamp up to which interest has been crystallized
        // Liquidation
        uint16 liquidationThresholdBps;  // e.g. 6452 = 64.52%; set at creation, never changes
        // Lend offer link
        uint256 lendOfferId;   // on-chain LendOffer id; 0 means borrow-initiated (no offer) — safe because nextLendOfferId starts at 1
    }

    struct LendOffer {
        address lender;
        address principalToken;              // address(0) = native ETH
        uint256 principalAmount;
        uint16  collateralRatioBps;          // base ratio for unknown borrowers, e.g. 20000 = 200%
        uint16  trustedRatioBps;             // discounted ratio for high-score borrowers, e.g. 13000 = 130%
        uint16  scoreThreshold;             // minimum score to qualify for trustedRatioBps (e.g. 750)
        uint16  maxLtvBps;
        uint16  interestRateBps;
        uint256 durationSeconds;
        uint256 acceptDeadline;
        bool    active;
        bool    accepted;
        uint256 acceptedLoanId;
    }

    // --- EIP-712 Signed Order Structs ---

    struct SignedLoanRequest {
        address borrower;
        address collateralToken;
        uint256 collateralAmount;
        address principalToken;
        uint256 principalAmount;
        uint16  interestRateBps;
        uint256 durationSeconds;
        uint16  maxLtvBps;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignedLendOffer {
        address lender;
        address principalToken;
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

    // --- State Variables ---

    mapping(address => uint256) public deposits;
    mapping(uint256 => Loan) public loans;         // single source of truth for all loan/collateral data
    uint256 public nextLoanId;
    mapping(address => uint256) public lockedEthCollateral; // per-borrower ETH aggregate

    // --- Interest accrual cadence ---
    // Interest recomputes once per accrual period. The annual rate is preserved:
    // PERIODS_PER_YEAR = number of accrual periods in a 365-day year.
    uint256 private constant ACCRUAL_PERIOD = 86400;        // 1 day in seconds
    uint256 private constant PERIODS_PER_YEAR = 365;        // days per year

    // --- Protocol fee ---
    // A percentage of the *interest* portion of each repayment is routed to the
    // protocol treasury; the lender receives the remainder. Principal is never
    // taxed. If `protocolTreasury` is unset (address(0)) or `protocolFeeBps` is 0,
    // no fee is taken and the lender receives the full payment.
    address public protocolTreasury;
    uint256 public protocolFeeBps;                        // 1000 = 10% of interest
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 5000;  // hard cap: 50% of interest

    // --- Pull-over-push payouts ---
    // Lender principal+interest and treasury fees are CREDITED here during repayment
    // instead of being pushed to the recipient. Recipients later pull their funds via
    // `withdrawPayments`, so a recipient that reverts on receipt can never block a
    // borrower's repayment. `token == address(0)` represents native ETH.
    mapping(address => mapping(address => uint256)) public pendingPayments; // account => token => amount

    // --- Reentrancy guard ---
    // Minimal inline non-reentrant guard (the installed OpenZeppelin upgradeable package
    // does not ship ReentrancyGuardUpgradeable).
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    // --- EIP-712 typehashes ---
    bytes32 private constant LOAN_REQUEST_TYPEHASH = keccak256(
        "LoanRequest(address borrower,address collateralToken,uint256 collateralAmount,address principalToken,uint256 principalAmount,uint16 interestRateBps,uint256 durationSeconds,uint16 maxLtvBps,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant LEND_OFFER_TYPEHASH = keccak256(
        "LendOffer(address lender,address principalToken,uint256 principalAmount,uint16 collateralRatioBps,uint16 trustedRatioBps,uint16 scoreThreshold,uint16 maxLtvBps,uint16 interestRateBps,uint256 durationSeconds,uint256 nonce,uint256 deadline)"
    );

    // --- Minimum interest floor ---
    // Interest accrues on the OUTSTANDING principal (principal - principalRepaid), so a
    // borrower who repays early pays proportionally less interest. To stop an instant repayment
    // from undercutting lenders entirely, an optional origination floor of
    // `principal * minInterestBps / 10000` is charged as interest the moment a loan is funded.
    // 0 (the default) disables the floor, giving pure time-based outstanding-balance interest.
    uint256 public minInterestBps;
    uint256 public constant MAX_MIN_INTEREST_BPS = 10000; // hard cap: 100% of principal

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // --- Oracle & liquidation ---
    mapping(address token => AggregatorV3Interface) public priceFeeds;
    uint256 public constant STALE_PRICE_THRESHOLD = 1 hours;
    mapping(address token => uint8) public tokenDecimals;

    uint256 public liquidationBonusBps;                          // default 500 = 5%
    uint256 public constant MAX_LIQUIDATION_BONUS_BPS = 2000;    // hard cap: 20%

    // --- Lend offers ---
    mapping(uint256 => LendOffer) public lendOffers;
    uint256 public nextLendOfferId;

    // --- Signed orders ---
    mapping(bytes32 => bool) public consumedSignatures;

    // --- Score attestation ---
    // The protocol backend signs (borrower, score, expiry) with this key.
    // The contract verifies the signature to grant the trusted collateral ratio.
    address public scoreSigner;

    // --- LTV attestation ---
    // The same backend key signs an EIP-712 LtvAttestation authorising a maximum
    // liquidationThresholdBps for a specific borrower. createLoan / createLoanWithERC20
    // verify this before accepting the caller-supplied liquidationThresholdBps.
    mapping(address => uint256) public nonces;

    bytes32 private constant LTV_ATTESTATION_TYPEHASH =
        keccak256("LtvAttestation(address borrower,address collateralToken,address borrowToken,uint16 maxLtvBps,uint256 expiry,uint256 nonce)");

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

    event LoanCancelled(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 timestamp
    );

    event LoanExpired(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 timestamp
    );

    event ProtocolTreasuryUpdated(address indexed treasury);
    event ProtocolFeeUpdated(uint256 feeBps);
    event ProtocolFeeCollected(uint256 indexed loanId, address indexed token, uint256 amount);
    event MinInterestUpdated(uint256 minInterestBps);

    event PaymentCredited(address indexed account, address indexed token, uint256 amount);
    event PaymentWithdrawn(address indexed account, address indexed token, uint256 amount);

    event LoanLiquidated(
        uint256 indexed loanId,
        address indexed liquidator,
        uint256 amountPaid,
        uint256 collateralSeized,
        uint256 collateralReturned,
        uint256 timestamp
    );
    event LiquidationBonusUpdated(uint256 bonusBps);
    event ScoreSignerUpdated(address indexed signer);
    event LtvAttestationUsed(address indexed borrower, uint256 nonce);

    event LendOfferCreated(
        uint256 indexed offerId,
        address indexed lender,
        address principalToken,
        uint256 principalAmount
    );
    event LendOfferAccepted(
        uint256 indexed offerId,
        uint256 indexed loanId,
        address indexed borrower
    );
    event LendOfferCancelled(uint256 indexed offerId, address indexed lender);
    event LendOfferExpired(uint256 indexed offerId);

    event SignedLoanRequestFilled(
        uint256 indexed loanId, bytes32 indexed digest, address indexed borrower, address lender,
        address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint256 timestamp
    );

    event SignedLendOfferFilled(
        uint256 indexed loanId, bytes32 indexed digest, address indexed lender, address borrower,
        address principalToken, uint256 principalAmount, address collateralToken, uint256 collateralAmount, uint256 timestamp
    );

    event SignedLoanRequestCancelled(bytes32 indexed digest, address indexed borrower);
    event SignedLendOfferCancelled(bytes32 indexed digest, address indexed lender);

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
        // __EIP712_init is called here to satisfy the OZ upgrades validator; the stored
        // name/version are never read because _EIP712Name()/_EIP712Version() are pure overrides.
        __EIP712_init("Vouch", "1");
        _reentrancyStatus = _NOT_ENTERED;
        nextLendOfferId = 1; // reserve 0 as the sentinel for "no lend offer" on Loan.lendOfferId
        protocolTreasury = initialOwner; // default treasury; owner can change later
        protocolFeeBps = 1000;           // default 10% of interest
        liquidationBonusBps = 500;       // default 5% liquidation bonus
    }

    /**
     * @dev Required by UUPSUpgradeable to restrict who can upgrade the contract.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Set the address that receives protocol fees.
     * @param newTreasury The new treasury address (cannot be the zero address).
     */
    function setProtocolTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Treasury cannot be zero address");
        protocolTreasury = newTreasury;
        emit ProtocolTreasuryUpdated(newTreasury);
    }

    /**
     * @notice Set the protocol fee taken from the interest portion of repayments.
     * @param newFeeBps Fee in basis points (1000 = 10%), capped at MAX_PROTOCOL_FEE_BPS.
     */
    function setProtocolFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_PROTOCOL_FEE_BPS, "Fee exceeds max");
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeBps);
    }

    /**
     * @notice Set the minimum interest floor charged as an origination fee when a loan is funded.
     * @dev Charged as `principal * minInterestBps / 10000` interest at funding time, on top of
     *      time-based outstanding-balance interest. Protects lenders from instant-repayment
     *      undercutting. 0 disables the floor. Only affects loans funded after this is set.
     * @param newMinInterestBps Floor in basis points of principal (1000 = 10%), capped at MAX_MIN_INTEREST_BPS.
     */
    function setMinInterestBps(uint256 newMinInterestBps) external onlyOwner {
        require(newMinInterestBps <= MAX_MIN_INTEREST_BPS, "Min interest exceeds max");
        minInterestBps = newMinInterestBps;
        emit MinInterestUpdated(newMinInterestBps);
    }

    /**
     * @notice Set the liquidation bonus paid to liquidators in basis points.
     * @param newBonusBps Bonus in basis points (500 = 5%), capped at MAX_LIQUIDATION_BONUS_BPS.
     */
    function setLiquidationBonusBps(uint256 newBonusBps) external onlyOwner {
        require(newBonusBps <= MAX_LIQUIDATION_BONUS_BPS, "Bonus exceeds max");
        liquidationBonusBps = newBonusBps;
        emit LiquidationBonusUpdated(newBonusBps);
    }

    function setScoreSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Signer cannot be zero address");
        scoreSigner = newSigner;
        emit ScoreSignerUpdated(newSigner);
    }

    /**
     * @dev Compute the protocol fee on the interest portion of a single payment.
     *      Returns 0 when the treasury is unset or the fee rate is 0.
     */
    function _protocolFee(uint256 interestPortion) internal view returns (uint256) {
        if (protocolTreasury == address(0) || protocolFeeBps == 0 || interestPortion == 0) {
            return 0;
        }
        return (interestPortion * protocolFeeBps) / 10000;
    }

    /// @dev Credit a pull-payment to `account` for `token` (address(0) = native ETH).
    function _creditPayment(address account, address token, uint256 amount) internal {
        if (amount == 0) return;
        pendingPayments[account][token] += amount;
        emit PaymentCredited(account, token, amount);
    }

    /// @dev Pay `amount` of native ETH to `recipient`. Attempts a direct transfer first
    ///      (instant for well-behaved recipients) and falls back to a credited pull-payment
    ///      if the recipient rejects the ETH, so a reverting recipient can never block the
    ///      calling operation (e.g. a borrower's repayment).
    function _payoutEth(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(recipient).call{value: amount}("");
        if (!ok) {
            _creditPayment(recipient, address(0), amount);
        }
    }

    /// @dev Pay `amount` of `token` (already held by this contract) to `recipient`.
    ///      Attempts a direct transfer first and falls back to a credited pull-payment if
    ///      the transfer fails. Uses a low-level call so a failed transfer cannot revert the
    ///      calling operation, and tolerates non-standard ERC20s that don't return a bool.
    function _payoutToken(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        bool ok = success && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));
        if (!ok) {
            _creditPayment(recipient, token, amount);
        }
    }

    /**
     * @notice Withdraw funds credited to the caller (lender repayments/interest or
     *         protocol fees). Uses the pull-payment pattern so a recipient that reverts
     *         on receipt can never block a borrower's repayment.
     * @param token The token to withdraw (address(0) for native ETH).
     */
    function withdrawPayments(address token) external nonReentrant {
        uint256 amount = pendingPayments[msg.sender][token];
        require(amount > 0, "Nothing to withdraw");
        pendingPayments[msg.sender][token] = 0;
        if (token == address(0)) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            require(ok, "ETH withdraw failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit PaymentWithdrawn(msg.sender, token, amount);
    }

    // --- Logic Functions ---

    function deposit() external payable {
        require(msg.value > 0, "Must deposit > 0");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @dev EIP-712 domain separator, recomputed per-call so it stays valid across chain forks.
    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("VouchVault")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    /// @dev Verify an LtvAttestation EIP-712 signature, then consume the nonce.
    function _verifyLtvAttestation(
        address borrower,
        address collateralToken,
        address borrowToken,
        uint16 maxLtvBps,
        uint256 expiry,
        bytes calldata sig
    ) internal {
        require(scoreSigner != address(0), "LTV attestation not configured");
        require(block.timestamp <= expiry, "Attestation expired");
        bytes32 structHash = keccak256(abi.encode(
            LTV_ATTESTATION_TYPEHASH,
            borrower,
            collateralToken,
            borrowToken,
            maxLtvBps,
            expiry,
            nonces[borrower]
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        require(ECDSA.recover(digest, sig) == scoreSigner, "Invalid attestation");
        emit LtvAttestationUsed(borrower, nonces[borrower]);
        nonces[borrower]++;
    }

    /// @notice Create a new loan by depositing ETH collateral
    /// @param principalToken          The token the borrower wants to receive (address(0) = native ETH)
    /// @param principalAmount         The amount the borrower wants to receive
    /// @param interestRateBps         Annual interest rate in basis points (e.g. 500 = 5% APR); 0 = interest-free
    /// @param durationSeconds         Loan term in seconds; caps interest accrual; 0 = no deadline / no time-based interest
    /// @param fundWindowSeconds       Seconds from creation during which the loan may be funded (must be > 0)
    /// @param liquidationThresholdBps Maximum LTV (debt/collateral) in basis points; the loan becomes liquidatable once the actual ratio exceeds this (e.g. 8000 = 80% max LTV)
    /// @param maxLtvBps               Backend-attested LTV ceiling for this borrower; liquidationThresholdBps must not exceed this
    /// @param expiry                  Attestation expiry timestamp (unix seconds)
    /// @param sig                     EIP-712 signature over LtvAttestation from scoreSigner
    function createLoan(
        address principalToken,
        uint256 principalAmount,
        uint16 interestRateBps,
        uint256 durationSeconds,
        uint256 fundWindowSeconds,
        uint16 liquidationThresholdBps,
        uint16 maxLtvBps,
        uint256 expiry,
        bytes calldata sig
    ) external payable {
        require(msg.value > 0, "Collateral must be > 0");
        require(principalAmount > 0, "Principal amount must be > 0");
        require(fundWindowSeconds > 0, "Fund window must be > 0");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(liquidationThresholdBps > 0 && liquidationThresholdBps <= 10000, "Invalid liquidation threshold");
        require(liquidationThresholdBps <= maxLtvBps, "Exceeds attested LTV");
        _verifyLtvAttestation(msg.sender, address(0), principalToken, maxLtvBps, expiry, sig);

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
            collateralReleased: 0,
            fundDeadline: block.timestamp + fundWindowSeconds,
            principalRepaid: 0,
            interestAccrued: 0,
            lastAccrualAt: 0,
            liquidationThresholdBps: liquidationThresholdBps,
            lendOfferId: 0
        });

        emit LoanCreated(nextLoanId, msg.sender, address(0), msg.value, principalToken, principalAmount, block.timestamp);
        nextLoanId++;
    }

    /// @notice Create a new loan by depositing ERC20 collateral
    /// @param token                   The ERC20 token to use as collateral
    /// @param amount                  The amount of collateral to deposit
    /// @param principalToken          The token the borrower wants to receive (address(0) = native ETH)
    /// @param principalAmount         The amount the borrower wants to receive
    /// @param interestRateBps         Annual interest rate in basis points (e.g. 500 = 5% APR); 0 = interest-free
    /// @param durationSeconds         Loan term in seconds; caps interest accrual; 0 = no deadline / no time-based interest
    /// @param fundWindowSeconds       Seconds from creation during which the loan may be funded (must be > 0)
    /// @param liquidationThresholdBps Maximum LTV (debt/collateral) in basis points; the loan becomes liquidatable once the actual ratio exceeds this (e.g. 8000 = 80% max LTV)
    /// @param maxLtvBps               Backend-attested LTV ceiling for this borrower; liquidationThresholdBps must not exceed this
    /// @param expiry                  Attestation expiry timestamp (unix seconds)
    /// @param sig                     EIP-712 signature over LtvAttestation from scoreSigner
    function createLoanWithERC20(
        address token,
        uint256 amount,
        address principalToken,
        uint256 principalAmount,
        uint16 interestRateBps,
        uint256 durationSeconds,
        uint256 fundWindowSeconds,
        uint16 liquidationThresholdBps,
        uint16 maxLtvBps,
        uint256 expiry,
        bytes calldata sig
    ) external {
        require(amount > 0, "Collateral must be > 0");
        require(token != address(0), "Invalid token address");
        require(principalAmount > 0, "Principal amount must be > 0");
        require(fundWindowSeconds > 0, "Fund window must be > 0");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(liquidationThresholdBps > 0 && liquidationThresholdBps <= 10000, "Invalid liquidation threshold");
        require(liquidationThresholdBps <= maxLtvBps, "Exceeds attested LTV");
        _verifyLtvAttestation(msg.sender, token, principalToken, maxLtvBps, expiry, sig);

        // Transfer tokens from user to this vault (SafeERC20 handles non-compliant tokens).
        // Reject fee-on-transfer collateral tokens: collateralAmount is recorded as `amount`
        // and later returned in full, so a short receipt would leave reclaims underfunded.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(received == amount, "Fee-on-transfer collateral not supported");

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
            collateralReleased: 0,
            fundDeadline: block.timestamp + fundWindowSeconds,
            principalRepaid: 0,
            interestAccrued: 0,
            lastAccrualAt: 0,
            liquidationThresholdBps: liquidationThresholdBps,
            lendOfferId: 0
        });

        emit LoanCreated(nextLoanId, msg.sender, token, amount, principalToken, principalAmount, block.timestamp);
        nextLoanId++;
    }

    /// @notice Cancel an unfunded loan and return locked collateral to the borrower.
    /// @dev Callable any time before the loan is funded. Returns collateral in its original form.
    function cancelLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(msg.sender == loan.borrower, "Only borrower can cancel");
        require(!loan.funded, "Cannot cancel a funded loan");

        uint256 amount = loan.collateralAmount - loan.collateralReleased;

        loan.active = false;
        loan.collateralLocked = false;
        loan.collateralReleased = loan.collateralAmount;

        if (amount > 0) {
            if (loan.collateralToken == address(0)) {
                lockedEthCollateral[loan.borrower] -= amount;
                (bool ok, ) = payable(loan.borrower).call{value: amount}("");
                require(ok, "ETH collateral return failed");
            } else {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, amount);
            }
        }

        emit LoanCancelled(loanId, loan.borrower, block.timestamp);
    }

    /// @notice Expire a pending loan, returning collateral to the borrower.
    /// @dev Permissionless. Valid when the funding deadline has passed OR when price feeds are
    ///      configured and the loan is already undercollateralized (HF < 1e18).
    function expireLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(!loan.funded, "Loan already funded");

        bool deadlinePassed = block.timestamp > loan.fundDeadline;
        bool undercollateralized = address(priceFeeds[loan.collateralToken]) != address(0) &&
            address(priceFeeds[loan.requestedPrincipalToken]) != address(0) &&
            getHealthFactor(loanId) < 1e18;
        require(deadlinePassed || undercollateralized, "Loan cannot be expired yet");

        uint256 amount = loan.collateralAmount - loan.collateralReleased;

        loan.active = false;
        loan.collateralLocked = false;
        loan.collateralReleased = loan.collateralAmount;

        if (amount > 0) {
            if (loan.collateralToken == address(0)) {
                lockedEthCollateral[loan.borrower] -= amount;
                (bool ok, ) = payable(loan.borrower).call{value: amount}("");
                require(ok, "ETH collateral return failed");
            } else {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, amount);
            }
        }

        emit LoanExpired(loanId, loan.borrower, block.timestamp);
    }

    /// @notice Create a lend offer by depositing ETH as principal.
    /// @param collateralRatioBps  Base collateral ratio for unknown borrowers (e.g. 20000 = 200%).
    /// @param trustedRatioBps     Discounted ratio for borrowers whose score >= scoreThreshold (e.g. 13000 = 130%).
    ///                            Set to 0 to disable score-based discounts.
    /// @param scoreThreshold      Minimum credit score to qualify for trustedRatioBps (e.g. 750).
    /// @param maxLtvBps           Maximum LTV accepted (e.g. 6500 = 65%), in basis points
    /// @param interestRateBps     Annual interest rate in basis points the lender demands
    /// @param durationSeconds     Loan term in seconds
    /// @param acceptWindowSeconds Seconds from now within which the offer may be accepted (must be > 0)
    function createLendOffer(
        uint16  collateralRatioBps,
        uint16  trustedRatioBps,
        uint16  scoreThreshold,
        uint16  maxLtvBps,
        uint16  interestRateBps,
        uint256 durationSeconds,
        uint256 acceptWindowSeconds
    ) external payable {
        require(msg.value > 0, "Principal must be > 0");
        require(collateralRatioBps >= 10000, "Collateral ratio must be >= 100%");
        require(trustedRatioBps == 0 || (trustedRatioBps >= 10000 && trustedRatioBps <= collateralRatioBps), "Invalid trustedRatioBps");
        require(maxLtvBps > 0 && maxLtvBps <= 10000, "Invalid maxLtvBps");
        { uint16 _minRatio = trustedRatioBps > 0 ? trustedRatioBps : collateralRatioBps;
          require(uint256(maxLtvBps) * _minRatio >= 10000 * 10000, "maxLtvBps below ratio-implied LTV"); }
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(acceptWindowSeconds > 0, "Accept window must be > 0");

        lendOffers[nextLendOfferId] = LendOffer({
            lender: msg.sender,
            principalToken: address(0),
            principalAmount: msg.value,
            collateralRatioBps: collateralRatioBps,
            trustedRatioBps: trustedRatioBps,
            scoreThreshold: scoreThreshold,
            maxLtvBps: maxLtvBps,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            acceptDeadline: block.timestamp + acceptWindowSeconds,
            active: true,
            accepted: false,
            acceptedLoanId: 0
        });

        emit LendOfferCreated(nextLendOfferId, msg.sender, address(0), msg.value);
        nextLendOfferId++;
    }

    /// @notice Create a lend offer by depositing an ERC20 token as principal.
    function createLendOfferWithERC20(
        address principalToken,
        uint256 principalAmount,
        uint16  collateralRatioBps,
        uint16  trustedRatioBps,
        uint16  scoreThreshold,
        uint16  maxLtvBps,
        uint16  interestRateBps,
        uint256 durationSeconds,
        uint256 acceptWindowSeconds
    ) external nonReentrant {
        require(principalToken != address(0), "Invalid principal token");
        require(principalAmount > 0, "Principal must be > 0");
        require(collateralRatioBps >= 10000, "Collateral ratio must be >= 100%");
        require(trustedRatioBps == 0 || (trustedRatioBps >= 10000 && trustedRatioBps <= collateralRatioBps), "Invalid trustedRatioBps");
        require(maxLtvBps > 0 && maxLtvBps <= 10000, "Invalid maxLtvBps");
        { uint16 _minRatio = trustedRatioBps > 0 ? trustedRatioBps : collateralRatioBps;
          require(uint256(maxLtvBps) * _minRatio >= 10000 * 10000, "maxLtvBps below ratio-implied LTV"); }
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(acceptWindowSeconds > 0, "Accept window must be > 0");

        uint256 balanceBefore = IERC20(principalToken).balanceOf(address(this));
        IERC20(principalToken).safeTransferFrom(msg.sender, address(this), principalAmount);
        uint256 received = IERC20(principalToken).balanceOf(address(this)) - balanceBefore;
        require(received == principalAmount, "Fee-on-transfer principal not supported");

        lendOffers[nextLendOfferId] = LendOffer({
            lender: msg.sender,
            principalToken: principalToken,
            principalAmount: principalAmount,
            collateralRatioBps: collateralRatioBps,
            trustedRatioBps: trustedRatioBps,
            scoreThreshold: scoreThreshold,
            maxLtvBps: maxLtvBps,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            acceptDeadline: block.timestamp + acceptWindowSeconds,
            active: true,
            accepted: false,
            acceptedLoanId: 0
        });

        emit LendOfferCreated(nextLendOfferId, msg.sender, principalToken, principalAmount);
        nextLendOfferId++;
    }

    /// @dev Internal helper: create a Loan record from an accepted LendOffer.
    ///      The loan starts funded (lender + principal already set).
    function _createLoanFromOffer(
        uint256 offerId,
        LendOffer storage offer,
        address collateralToken,
        uint256 collateralAmount
    ) internal returns (uint256 loanId) {
        loanId = nextLoanId;
        loans[loanId] = Loan({
            borrower: msg.sender,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            collateralLocked: true,
            collateralReleased: 0,
            createdAt: block.timestamp,
            active: true,
            funded: true,
            repaid: false,
            fundDeadline: block.timestamp,         // already funded; deadline irrelevant
            lender: offer.lender,
            requestedPrincipalToken: offer.principalToken,
            requestedPrincipalAmount: offer.principalAmount,
            principalAmount: offer.principalAmount,
            fundedAt: block.timestamp,
            interestRateBps: offer.interestRateBps,
            durationSeconds: offer.durationSeconds,
            amountRepaid: 0,
            principalRepaid: 0,
            interestAccrued: 0,
            lastAccrualAt: block.timestamp,
            liquidationThresholdBps: offer.maxLtvBps,
            lendOfferId: offerId
        });
        nextLoanId++;
    }

    /// @dev Internal helper: create a Loan record from an EIP-712 signed loan request.
    ///      The loan starts funded (lender already set, collateral and principal settled).
    function _createLoanFromSignedRequest(
        SignedLoanRequest calldata req,
        address lender
    ) internal returns (uint256 loanId) {
        loanId = nextLoanId;
        loans[loanId] = Loan({
            borrower: req.borrower,
            collateralToken: req.collateralToken,
            collateralAmount: req.collateralAmount,
            collateralLocked: true,
            collateralReleased: 0,
            createdAt: block.timestamp,
            active: true,
            funded: true,
            repaid: false,
            fundDeadline: block.timestamp,         // already funded; deadline irrelevant
            lender: lender,
            requestedPrincipalToken: req.principalToken,
            requestedPrincipalAmount: req.principalAmount,
            principalAmount: req.principalAmount,
            fundedAt: block.timestamp,
            interestRateBps: req.interestRateBps,
            durationSeconds: req.durationSeconds,
            amountRepaid: 0,
            principalRepaid: 0,
            interestAccrued: 0,
            lastAccrualAt: block.timestamp,
            liquidationThresholdBps: req.maxLtvBps,
            lendOfferId: 0
        });
        nextLoanId++;
    }

    /// @notice A lender fills a borrower's EIP-712 signed loan request.
    /// @dev    Verifies the borrower's signature, pulls ERC20 collateral from the borrower,
    ///         the lender supplies principal (ETH or ERC20), a funded loan is created,
    ///         and the signature digest is consumed to prevent replay.
    function fillLoanRequest(SignedLoanRequest calldata req, bytes calldata sig) external payable nonReentrant {
        require(req.collateralToken != address(0), "Collateral must be ERC20");
        require(req.collateralAmount > 0, "Collateral must be > 0");
        require(req.principalAmount > 0, "Principal must be > 0");
        require(req.maxLtvBps > 0 && req.maxLtvBps <= 10000, "Invalid maxLtvBps");
        require(req.interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(block.timestamp <= req.deadline, "Request expired");

        bytes32 digest = hashLoanRequest(req);
        require(!consumedSignatures[digest], "Signature already used");
        require(ECDSA.recover(digest, sig) == req.borrower, "Invalid signature");

        // Checks-effects-interactions: mark consumed before any external call.
        consumedSignatures[digest] = true;

        // Pull ERC20 collateral from borrower (fee-on-transfer guard).
        uint256 balBefore = IERC20(req.collateralToken).balanceOf(address(this));
        IERC20(req.collateralToken).safeTransferFrom(req.borrower, address(this), req.collateralAmount);
        uint256 received = IERC20(req.collateralToken).balanceOf(address(this)) - balBefore;
        require(received == req.collateralAmount, "Fee-on-transfer collateral not supported");

        // Convert the LTV (<=10000) into an implied collateral ratio (>=10000):
        // impliedRatioBps = 10000 * 10000 / maxLtvBps
        // e.g. maxLtvBps=6500 -> 10000^2/6500 ~= 15384 bps ~= 153.84% collateralization.
        // The require above ensures maxLtvBps > 0, so division is safe.
        uint256 impliedRatioBps = Math.mulDiv(10000, 10000, req.maxLtvBps);
        _checkCollateralValueRaw(req.principalToken, req.principalAmount, req.collateralToken, req.collateralAmount, impliedRatioBps);

        uint256 loanId = _createLoanFromSignedRequest(req, msg.sender);

        // Lender (msg.sender) supplies principal to borrower.
        if (req.principalToken == address(0)) {
            require(msg.value == req.principalAmount, "Incorrect ETH principal");
            _payoutEth(req.borrower, req.principalAmount);
        } else {
            require(msg.value == 0, "Unexpected ETH");
            uint256 pBefore = IERC20(req.principalToken).balanceOf(address(this));
            IERC20(req.principalToken).safeTransferFrom(msg.sender, address(this), req.principalAmount);
            require(IERC20(req.principalToken).balanceOf(address(this)) - pBefore == req.principalAmount, "Fee-on-transfer principal not supported");
            _payoutToken(req.principalToken, req.borrower, req.principalAmount);
        }

        emit SignedLoanRequestFilled(loanId, digest, req.borrower, msg.sender, req.collateralToken, req.collateralAmount, req.principalToken, req.principalAmount, block.timestamp);
    }

    /// @dev Internal helper: create a Loan record from an EIP-712 signed lend offer.
    ///      The loan starts funded (lender + principal already set by fillLendOffer).
    function _createLoanFromSignedOffer(
        SignedLendOffer calldata offer,
        address borrower,
        address collateralToken,
        uint256 collateralAmount
    ) internal returns (uint256 loanId) {
        loanId = nextLoanId;
        loans[loanId] = Loan({
            borrower: borrower,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            collateralLocked: true,
            collateralReleased: 0,
            createdAt: block.timestamp,
            active: true,
            funded: true,
            repaid: false,
            fundDeadline: block.timestamp,         // already funded; deadline irrelevant
            lender: offer.lender,
            requestedPrincipalToken: offer.principalToken,
            requestedPrincipalAmount: offer.principalAmount,
            principalAmount: offer.principalAmount,
            fundedAt: block.timestamp,
            interestRateBps: offer.interestRateBps,
            durationSeconds: offer.durationSeconds,
            amountRepaid: 0,
            principalRepaid: 0,
            interestAccrued: 0,
            lastAccrualAt: block.timestamp,
            liquidationThresholdBps: offer.maxLtvBps,
            lendOfferId: 0
        });
        nextLoanId++;
    }

    /// @notice A borrower fills a lender's EIP-712 signed lend offer.
    /// @dev    Verifies the lender's EIP-712 signature, pulls ERC20 principal from the lender,
    ///         the borrower supplies collateral (ETH via msg.value OR ERC20 via approve),
    ///         a funded loan is created, principal is disbursed to the borrower,
    ///         and the signature digest is consumed to prevent replay.
    /// @param offer            The signed lend offer struct.
    /// @param collateralToken  Collateral token provided by the borrower at fill time (address(0) = native ETH).
    /// @param collateralAmount Amount of ERC20 collateral to pull when collateralToken != address(0). Ignored for ETH collateral (uses msg.value).
    /// @param sig              EIP-712 signature from offer.lender over the offer hash.
    function fillLendOffer(SignedLendOffer calldata offer, address collateralToken, uint256 collateralAmount, bytes calldata sig) external payable nonReentrant {
        require(offer.principalToken != address(0), "Principal must be ERC20");
        require(offer.principalAmount > 0, "Principal must be > 0");
        require(offer.collateralRatioBps >= 10000, "Collateral ratio must be >= 100%");
        require(offer.trustedRatioBps == 0 || (offer.trustedRatioBps >= 10000 && offer.trustedRatioBps <= offer.collateralRatioBps), "Invalid trustedRatioBps");
        require(offer.maxLtvBps > 0 && offer.maxLtvBps <= 10000, "Invalid maxLtvBps");
        require(offer.interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(block.timestamp <= offer.deadline, "Offer expired");

        bytes32 digest = hashLendOffer(offer);
        require(!consumedSignatures[digest], "Signature already used");
        require(ECDSA.recover(digest, sig) == offer.lender, "Invalid signature");

        // Checks-effects-interactions: mark consumed before any external call.
        consumedSignatures[digest] = true;

        // The borrower chooses the collateral token at fill time (collateralToken parameter).
        // address(0) means native ETH (send via msg.value); any other address is an ERC20.
        address _collateralToken;
        uint256 _collateralAmount;
        if (collateralToken == address(0)) {
            // ETH collateral path
            require(msg.value > 0, "Collateral required");
            _collateralToken = address(0);
            _collateralAmount = msg.value;
            lockedEthCollateral[msg.sender] += msg.value;
        } else {
            // ERC20 collateral path
            require(msg.value == 0, "Unexpected ETH");
            require(collateralAmount > 0, "Collateral required");
            _collateralToken = collateralToken;
            _collateralAmount = collateralAmount;
            uint256 balBefore = IERC20(_collateralToken).balanceOf(address(this));
            IERC20(_collateralToken).safeTransferFrom(msg.sender, address(this), _collateralAmount);
            uint256 received = IERC20(_collateralToken).balanceOf(address(this)) - balBefore;
            require(received == _collateralAmount, "Fee-on-transfer collateral not supported");
        }

        // Signed offers fill at the base collateralRatioBps (no score attestation at fill time).
        // collateralRatioBps is already a ratio in bps (>= 10000), pass it directly.
        _checkCollateralValueRaw(offer.principalToken, offer.principalAmount, _collateralToken, _collateralAmount, offer.collateralRatioBps);

        // Pull ERC20 principal from lender (fee-on-transfer guard), then disburse to borrower.
        uint256 pBefore = IERC20(offer.principalToken).balanceOf(address(this));
        IERC20(offer.principalToken).safeTransferFrom(offer.lender, address(this), offer.principalAmount);
        require(IERC20(offer.principalToken).balanceOf(address(this)) - pBefore == offer.principalAmount, "Fee-on-transfer principal not supported");

        uint256 loanId = _createLoanFromSignedOffer(offer, msg.sender, _collateralToken, _collateralAmount);
        _payoutToken(offer.principalToken, msg.sender, offer.principalAmount);

        emit SignedLendOfferFilled(loanId, digest, offer.lender, msg.sender, offer.principalToken, offer.principalAmount, _collateralToken, _collateralAmount, block.timestamp);
    }

    /// @notice Cancel a signed loan request to prevent it from being filled.
    /// @dev    Only the borrower may cancel. Marks the digest as consumed to prevent any future fill.
    /// @param req The loan request to cancel.
    function cancelSignedLoanRequest(SignedLoanRequest calldata req) external {
        require(msg.sender == req.borrower, "Not signer");
        bytes32 digest = hashLoanRequest(req);
        require(!consumedSignatures[digest], "Signature already used");
        consumedSignatures[digest] = true;
        emit SignedLoanRequestCancelled(digest, req.borrower);
    }

    /// @notice Cancel a signed lend offer to prevent it from being filled.
    /// @dev    Only the lender may cancel. Marks the digest as consumed to prevent any future fill.
    /// @param offer The lend offer to cancel.
    function cancelSignedLendOffer(SignedLendOffer calldata offer) external {
        require(msg.sender == offer.lender, "Not signer");
        bytes32 digest = hashLendOffer(offer);
        require(!consumedSignatures[digest], "Signature already used");
        consumedSignatures[digest] = true;
        emit SignedLendOfferCancelled(digest, offer.lender);
    }

    /// @dev Recover the signer of a score attestation.
    ///      Message: keccak256(abi.encodePacked(borrower, score, expiry, address(this), block.chainid))
    function _recoverScoreSigner(
        address borrower,
        uint16 score,
        uint256 expiry,
        bytes calldata sig
    ) internal view returns (address) {
        bytes32 msgHash = keccak256(abi.encodePacked(borrower, score, expiry, address(this), block.chainid));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        return ethHash.recover(sig);
    }

    /// @dev Resolve the effective collateral ratio for a borrower given an optional attestation.
    ///      Returns trustedRatioBps if the attestation is valid and score >= threshold, else collateralRatioBps.
    function _effectiveRatio(
        LendOffer storage offer,
        uint16 score,
        uint256 expiry,
        bytes calldata sig
    ) internal view returns (uint16) {
        if (
            offer.trustedRatioBps > 0 &&
            sig.length > 0 &&
            scoreSigner != address(0) &&
            block.timestamp <= expiry &&
            score >= offer.scoreThreshold &&
            _recoverScoreSigner(msg.sender, score, expiry, sig) == scoreSigner
        ) {
            return offer.trustedRatioBps;
        }
        return offer.collateralRatioBps;
    }

    /// @dev Compute the minimum collateral USD value required given a specific ratio.
    function _minCollateralUsd(LendOffer storage offer, uint16 ratioBps) internal view returns (uint256) {
        uint256 principalPrice = _getPrice(offer.principalToken);
        uint256 normalizedPrincipal = _normalizeAmount(offer.principalToken, offer.principalAmount);
        uint256 principalUsd = normalizedPrincipal.mulDiv(principalPrice, 1e18);
        return principalUsd.mulDiv(ratioBps, 10000);
    }

    /// @dev Verify that `collateralAmount` of `collateralToken` meets the required ratio.
    function _checkCollateralValue(
        LendOffer storage offer,
        address collateralToken,
        uint256 collateralAmount,
        uint16 ratioBps
    ) internal view {
        uint256 collateralPrice = _getPrice(collateralToken);
        uint256 normalizedCollateral = _normalizeAmount(collateralToken, collateralAmount);
        uint256 collateralUsd = normalizedCollateral.mulDiv(collateralPrice, 1e18);
        require(collateralUsd >= _minCollateralUsd(offer, ratioBps), "Collateral value below required ratio");
    }

    /// @dev Ratio-agnostic collateral check: requires collateralUsd >= principalUsd * ratioBps / 10000.
    ///      `ratioBps` is a collateral RATIO in basis points (>= 10000, e.g. 15384 = 153.84%),
    ///      matching the convention of `_minCollateralUsd`/`_checkCollateralValue`.
    ///      Used by fillLoanRequest (which converts maxLtvBps to an implied ratio first) and
    ///      will be reused by fillLendOffer (Task 3) which passes collateralRatioBps directly.
    function _checkCollateralValueRaw(
        address principalToken,
        uint256 principalAmount,
        address collateralToken,
        uint256 collateralAmount,
        uint256 ratioBps
    ) internal view {
        uint256 principalPrice = _getPrice(principalToken);
        uint256 normalizedPrincipal = _normalizeAmount(principalToken, principalAmount);
        uint256 principalUsd = normalizedPrincipal.mulDiv(principalPrice, 1e18);
        uint256 minCollateralUsd = principalUsd.mulDiv(ratioBps, 10000);

        uint256 collateralPrice = _getPrice(collateralToken);
        uint256 normalizedCollateral = _normalizeAmount(collateralToken, collateralAmount);
        uint256 collateralUsd = normalizedCollateral.mulDiv(collateralPrice, 1e18);
        require(collateralUsd >= minCollateralUsd, "Collateral value below required ratio");
    }

    /// @notice Accept a lend offer by posting ETH as collateral.
    /// @param score  Borrower's credit score from the signed attestation (0 if not using score).
    /// @param expiry Attestation expiry timestamp.
    /// @param sig    Backend signature over (borrowerAddress, score, expiry). Empty bytes if no attestation.
    function acceptLendOffer(
        uint256 offerId,
        uint16 score,
        uint256 expiry,
        bytes calldata sig
    ) external payable nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Offer already accepted");
        require(block.timestamp <= offer.acceptDeadline, "Offer expired");
        require(msg.value > 0, "Collateral must be > 0");

        uint16 ratio = _effectiveRatio(offer, score, expiry, sig);
        _checkCollateralValue(offer, address(0), msg.value, ratio);

        offer.active = false;
        offer.accepted = true;

        lockedEthCollateral[msg.sender] += msg.value;

        uint256 loanId = _createLoanFromOffer(offerId, offer, address(0), msg.value);
        offer.acceptedLoanId = loanId;

        if (minInterestBps > 0) {
            loans[loanId].interestAccrued = (offer.principalAmount * minInterestBps) / 10000;
        }

        if (offer.principalToken == address(0)) {
            _payoutEth(msg.sender, offer.principalAmount);
        } else {
            _payoutToken(offer.principalToken, msg.sender, offer.principalAmount);
        }

        emit LendOfferAccepted(offerId, loanId, msg.sender);
    }

    /// @notice Accept a lend offer by posting any ERC20 token as collateral.
    /// @param collateralToken  ERC20 token the borrower wants to post (must have a price feed).
    /// @param collateralAmount Amount of that token to lock.
    /// @param score   Borrower's credit score (0 if not using attestation).
    /// @param expiry  Attestation expiry timestamp.
    /// @param sig     Backend signature. Empty bytes if no attestation.
    function acceptLendOfferWithERC20(
        uint256 offerId,
        address collateralToken,
        uint256 collateralAmount,
        uint16 score,
        uint256 expiry,
        bytes calldata sig
    ) external nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Offer already accepted");
        require(block.timestamp <= offer.acceptDeadline, "Offer expired");
        require(collateralToken != address(0), "Use acceptLendOffer for ETH collateral");
        require(collateralAmount > 0, "Collateral must be > 0");

        uint16 ratio = _effectiveRatio(offer, score, expiry, sig);
        _checkCollateralValue(offer, collateralToken, collateralAmount, ratio);

        uint256 balanceBefore = IERC20(collateralToken).balanceOf(address(this));
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);
        uint256 received = IERC20(collateralToken).balanceOf(address(this)) - balanceBefore;
        require(received == collateralAmount, "Fee-on-transfer collateral not supported");

        offer.active = false;
        offer.accepted = true;

        uint256 loanId = _createLoanFromOffer(offerId, offer, collateralToken, collateralAmount);
        offer.acceptedLoanId = loanId;

        if (minInterestBps > 0) {
            loans[loanId].interestAccrued = (offer.principalAmount * minInterestBps) / 10000;
        }

        if (offer.principalToken == address(0)) {
            _payoutEth(msg.sender, offer.principalAmount);
        } else {
            _payoutToken(offer.principalToken, msg.sender, offer.principalAmount);
        }

        emit LendOfferAccepted(offerId, loanId, msg.sender);
    }

    /// @notice Cancel a lend offer and return the locked principal. Only the lender may call this.
    function cancelLendOffer(uint256 offerId) external nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Cannot cancel accepted offer");
        require(msg.sender == offer.lender, "Only lender can cancel");

        offer.active = false;

        if (offer.principalToken == address(0)) {
            _payoutEth(offer.lender, offer.principalAmount);
        } else {
            IERC20(offer.principalToken).safeTransfer(offer.lender, offer.principalAmount);
        }

        emit LendOfferCancelled(offerId, offer.lender);
    }

    /// @notice Expire a lend offer after its accept deadline. Permissionless. Returns principal to lender.
    function expireLendOffer(uint256 offerId) external nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "Offer not active");
        require(!offer.accepted, "Cannot expire accepted offer");
        require(block.timestamp > offer.acceptDeadline, "Offer still active");

        offer.active = false;

        if (offer.principalToken == address(0)) {
            _payoutEth(offer.lender, offer.principalAmount);
        } else {
            IERC20(offer.principalToken).safeTransfer(offer.lender, offer.principalAmount);
        }

        emit LendOfferExpired(offerId);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        
        deposits[msg.sender] -= amount;
        
        // Safety: use call instead of transfer to avoid gas limit issues
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH Transfer failed");
        
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Repay some or all of a funded ETH-principal loan.
     * @dev    Accepts any msg.value between 1 wei and the current remaining balance.
     *         Interest accrues per-day on the OUTSTANDING principal (principal - principalRepaid),
     *         so reducing principal lowers future interest (see `_accrue`). An optional origination
     *         floor (`minInterestBps`) may have been charged at funding.
     *
     *         Amortization is interest-first: each payment first covers the interest crystallized
     *         up to now, and only the remainder reduces principal. `principalRepaid` is monotonic.
     *
     *         Collateral is released proportional to principal repaid:
     *         floor(collateralAmount * principalDelta / principalAmount). On the final payment any
     *         rounding dust is also returned so all collateral is recovered.
     * @param loanId The ID of the loan to repay.
     */
    function repayLoan(uint256 loanId) external payable nonReentrant {
        Loan storage loan = loans[loanId];
        require(!loan.repaid, "Loan already repaid");
        require(loan.active, "Loan is not active");
        require(loan.funded, "Loan is not funded");
        require(msg.sender == loan.borrower, "Only borrower can repay");
        require(loan.requestedPrincipalToken == address(0), "Loan has ERC20 principal; use repayLoanWithERC20");
        require(msg.value > 0, "Payment must be > 0");

        // Crystallize interest on the current outstanding principal up to now.
        _accrue(loan);

        // Interest-first amortization with a monotonic principalRepaid.
        // Interest already paid in prior payments == amountRepaid - principalRepaid.
        uint256 interestAlreadyPaid = loan.amountRepaid - loan.principalRepaid;
        uint256 interestOutstanding = loan.interestAccrued > interestAlreadyPaid
            ? loan.interestAccrued - interestAlreadyPaid
            : 0;
        uint256 outstandingPrincipal = loan.principalAmount - loan.principalRepaid;
        uint256 remaining = interestOutstanding + outstandingPrincipal;
        require(msg.value <= remaining, "Payment exceeds amount owed");

        uint256 principalDelta = msg.value > interestOutstanding ? msg.value - interestOutstanding : 0;

        loan.amountRepaid += msg.value;
        loan.principalRepaid += principalDelta;

        bool fullRepayment = msg.value == remaining;

        // Collateral released proportional to principal repaid; final payment returns the dust.
        uint256 collateralToRelease = fullRepayment
            ? loan.collateralAmount - loan.collateralReleased
            : (loan.collateralAmount * principalDelta) / loan.principalAmount;

        loan.collateralReleased += collateralToRelease;

        if (fullRepayment) {
            loan.repaid = true;
            loan.active = false;
            loan.collateralLocked = false;
        }

        // Split the payment: protocol fee on the interest portion to treasury, rest to lender.
        // Each payout is attempted directly first and falls back to a credited pull-payment
        // (withdrawPayments) only if the recipient rejects the ETH, so a reverting
        // lender/treasury can never block the borrower's repayment.
        uint256 interestPortion = msg.value - principalDelta;
        uint256 protocolFee = _protocolFee(interestPortion);

        _payoutEth(loan.lender, msg.value - protocolFee);
        if (protocolFee > 0) {
            _payoutEth(protocolTreasury, protocolFee);
            emit ProtocolFeeCollected(loanId, address(0), protocolFee);
        }

        if (collateralToRelease > 0) {
            if (loan.collateralToken == address(0)) {
                lockedEthCollateral[loan.borrower] -= collateralToRelease;
                (bool borrowerOk, ) = payable(loan.borrower).call{value: collateralToRelease}("");
                require(borrowerOk, "ETH collateral return failed");
            } else {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, collateralToRelease);
            }
        }

        if (fullRepayment) {
            uint256 totalInterest = loan.amountRepaid - loan.principalAmount;
            emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.principalAmount, totalInterest, loan.amountRepaid, block.timestamp);
        } else {
            uint256 totalDueSnapshot = loan.principalAmount + loan.interestAccrued;
            emit LoanPartiallyRepaid(loanId, loan.borrower, msg.value, collateralToRelease, loan.amountRepaid, totalDueSnapshot, block.timestamp);
        }
    }

    /**
     * @notice Repay some or all of a funded ERC20-principal loan.
     * @dev    The borrower must approve this contract for at least `amount` of the principal token
     *         before calling. Interest accrues per-day on the OUTSTANDING principal
     *         (principal - principalRepaid), so reducing principal lowers future interest (see
     *         `_accrue`). An optional origination floor (`minInterestBps`) may have been charged
     *         at funding.
     *
     *         Amortization is interest-first: each payment first covers the interest crystallized
     *         up to now, and only the remainder reduces principal. `principalRepaid` is monotonic.
     *
     *         Collateral is released proportional to principal repaid:
     *         floor(collateralAmount * principalDelta / principalAmount), returned in its original
     *         form (ETH or ERC20). On the final payment any rounding dust is also returned so all
     *         collateral is recovered.
     * @param loanId  The ID of the loan to repay.
     * @param amount  The token amount to repay this call (must be > 0 and <= remaining balance).
     */
    function repayLoanWithERC20(uint256 loanId, uint256 amount) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(!loan.repaid, "Loan already repaid");
        require(loan.active, "Loan is not active");
        require(loan.funded, "Loan is not funded");
        require(msg.sender == loan.borrower, "Only borrower can repay");
        require(loan.requestedPrincipalToken != address(0), "Loan has ETH principal; use repayLoan");
        require(amount > 0, "Payment must be > 0");

        // Crystallize interest on the current outstanding principal up to now.
        _accrue(loan);

        // Interest-first amortization with a monotonic principalRepaid.
        uint256 interestAlreadyPaid = loan.amountRepaid - loan.principalRepaid;
        uint256 interestOutstanding = loan.interestAccrued > interestAlreadyPaid
            ? loan.interestAccrued - interestAlreadyPaid
            : 0;
        uint256 outstandingPrincipal = loan.principalAmount - loan.principalRepaid;
        uint256 remaining = interestOutstanding + outstandingPrincipal;
        require(amount <= remaining, "Payment exceeds amount owed");

        uint256 principalDelta = amount > interestOutstanding ? amount - interestOutstanding : 0;

        loan.amountRepaid += amount;
        loan.principalRepaid += principalDelta;

        bool fullRepayment = amount == remaining;

        // Collateral released proportional to principal repaid; final payment returns the dust.
        uint256 collateralToRelease = fullRepayment
            ? loan.collateralAmount - loan.collateralReleased
            : (loan.collateralAmount * principalDelta) / loan.principalAmount;

        loan.collateralReleased += collateralToRelease;

        if (fullRepayment) {
            loan.repaid = true;
            loan.active = false;
            loan.collateralLocked = false;
        }

        // Pull the full payment into the vault, then pay out: protocol fee on the interest
        // portion to the treasury, the remainder to the lender. Each payout is attempted
        // directly first and falls back to a credited pull-payment (withdrawPayments) only if
        // the transfer fails, so a reverting lender/treasury can never block repayment.
        uint256 interestPortion = amount - principalDelta;
        uint256 protocolFee = _protocolFee(interestPortion);

        // Reject fee-on-transfer principal tokens: payouts assume the vault received exactly
        // `amount`, so a short receipt would credit lenders/treasury for funds we don't hold.
        uint256 balanceBefore = IERC20(loan.requestedPrincipalToken).balanceOf(address(this));
        IERC20(loan.requestedPrincipalToken).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(loan.requestedPrincipalToken).balanceOf(address(this)) - balanceBefore;
        require(received == amount, "Fee-on-transfer principal not supported");

        _payoutToken(loan.requestedPrincipalToken, loan.lender, amount - protocolFee);
        if (protocolFee > 0) {
            _payoutToken(loan.requestedPrincipalToken, protocolTreasury, protocolFee);
            emit ProtocolFeeCollected(loanId, loan.requestedPrincipalToken, protocolFee);
        }

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
            uint256 totalInterest = loan.amountRepaid - loan.principalAmount;
            emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.principalAmount, totalInterest, loan.amountRepaid, block.timestamp);
        } else {
            uint256 totalDueSnapshot = loan.principalAmount + loan.interestAccrued;
            emit LoanPartiallyRepaid(loanId, loan.borrower, amount, collateralToRelease, loan.amountRepaid, totalDueSnapshot, block.timestamp);
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
    function fundLoan(uint256 loanId) external payable nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(!loan.funded, "Loan already funded");
        require(msg.sender != loan.borrower, "Borrower cannot fund own loan");
        require(block.timestamp <= loan.fundDeadline, "Funding window passed");
        require(loan.requestedPrincipalToken == address(0), "Token does not match requested principal token");
        require(msg.value == loan.requestedPrincipalAmount, "msg.value must equal requested principal amount");
        if (address(priceFeeds[loan.collateralToken]) != address(0) &&
            address(priceFeeds[loan.requestedPrincipalToken]) != address(0)) {
            require(getHealthFactor(loanId) >= 1e18, "Loan is undercollateralized");
        }

        loan.lender = msg.sender;
        loan.principalAmount = loan.requestedPrincipalAmount;
        loan.funded = true;
        loan.fundedAt = block.timestamp;
        // Start the interest clock and apply the optional origination floor.
        loan.lastAccrualAt = block.timestamp;
        loan.interestAccrued = (loan.principalAmount * minInterestBps) / 10000;

        // Transfer principal directly to the borrower.
        (bool success, ) = payable(loan.borrower).call{value: loan.requestedPrincipalAmount}("");
        require(success, "ETH transfer to borrower failed");

        emit LoanFunded(loanId, msg.sender, loan.borrower, loan.requestedPrincipalAmount, block.timestamp);
    }

    /// @notice Fund a loan with an ERC20 principal token
    /// @param loanId The ID of the loan to fund
    /// @param token  The ERC20 token address to send as principal (must match requestedPrincipalToken)
    /// @param amount The amount of tokens to send (must match requestedPrincipalAmount)
    function fundLoanWithERC20(uint256 loanId, address token, uint256 amount) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan is not active");
        require(!loan.funded, "Loan already funded");
        require(msg.sender != loan.borrower, "Borrower cannot fund own loan");
        require(block.timestamp <= loan.fundDeadline, "Funding window passed");
        require(loan.requestedPrincipalToken != address(0), "Loan requires native ETH principal; use fundLoan");
        require(amount > 0, "Funding amount must be > 0");
        require(token == loan.requestedPrincipalToken, "Token does not match requested principal token");
        require(amount == loan.requestedPrincipalAmount, "Amount does not match requested principal amount");
        if (address(priceFeeds[loan.collateralToken]) != address(0) &&
            address(priceFeeds[loan.requestedPrincipalToken]) != address(0)) {
            require(getHealthFactor(loanId) >= 1e18, "Loan is undercollateralized");
        }

        loan.lender = msg.sender;
        loan.principalAmount = amount;
        loan.funded = true;
        loan.fundedAt = block.timestamp;
        // Start the interest clock and apply the optional origination floor.
        loan.lastAccrualAt = block.timestamp;
        loan.interestAccrued = (loan.principalAmount * minInterestBps) / 10000;

        // Transfer principal directly to the borrower.
        IERC20(token).safeTransferFrom(msg.sender, loan.borrower, amount);

        emit LoanFunded(loanId, msg.sender, loan.borrower, amount, block.timestamp);
    }

    // --- Oracle Functions ---

    function setPriceFeed(address token, address feed, uint8 decimals_) external onlyOwner {
        require(feed != address(0), "Invalid feed address");
        // No real token exceeds 18 decimals; capping here keeps _normalizeAmount's
        // 10 ** (dec - 18) branch unreachable, so a misconfigured value can't make
        // getHealthFactor revert (and become permanently unusable) for this token.
        require(decimals_ <= 18, "Decimals must be <= 18");
        // 0 is also rejected: _normalizeAmount treats a stored 0 as "not set" and
        // defaults it to 18, so an accidental 0 here would silently pass through
        // as if this token had 18 decimals instead of reverting loudly.
        require(decimals_ > 0, "Decimals must be > 0");
        priceFeeds[token] = AggregatorV3Interface(feed);
        tokenDecimals[token] = decimals_;
    }

    function _getPrice(address token) internal view returns (uint256) {
        AggregatorV3Interface feed = priceFeeds[token];
        require(address(feed) != address(0), "No price feed for token");
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(price > 0, "Invalid price");
        require(updatedAt != 0, "Round not complete");
        // Per Chainlink's own guidance: answeredInRound < roundId means this round
        // carried over a stale answer from an earlier round (e.g. during an
        // aggregator outage) rather than a fresh one.
        require(answeredInRound >= roundId, "Stale round");
        // Guard the subtraction explicitly rather than relying on 0.8's checked
        // arithmetic to revert: a misconfigured or malicious feed reporting an
        // updatedAt in the future would otherwise brick this token with a bare
        // underflow panic instead of a clear revert reason.
        require(updatedAt <= block.timestamp, "Price timestamp in the future");
        require(block.timestamp - updatedAt <= STALE_PRICE_THRESHOLD, "Stale price");
        uint8 feedDecimals = feed.decimals();
        // feedDecimals is untrusted external input (the feed contract's own
        // decimals() call); real Chainlink feeds are always <= 18, but without
        // this check a misconfigured/malicious feed reporting a large value would
        // make 10 ** (feedDecimals - 18) revert, bricking price reads for this token.
        require(feedDecimals <= 18, "Feed decimals too large");
        // Normalize to 18 decimals
        if (feedDecimals < 18) {
            return uint256(price) * (10 ** (18 - feedDecimals));
        } else if (feedDecimals > 18) {
            return uint256(price) / (10 ** (feedDecimals - 18));
        }
        return uint256(price);
    }

    function _normalizeAmount(address token, uint256 amount) internal view returns (uint256) {
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = 18;
        if (dec < 18) return amount * (10 ** (18 - dec));
        if (dec > 18) return amount / (10 ** (dec - 18));
        return amount;
    }

    // Inverse of _normalizeAmount: converts an 18-dec scaled amount back to the token's native decimals.
    function _denormalizeAmount(address token, uint256 amount) internal view returns (uint256) {
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = 18;
        if (dec < 18) return amount / (10 ** (18 - dec));
        if (dec > 18) return amount * (10 ** (dec - 18));
        return amount;
    }

    // Round-up variant used when undercharging the liquidator would underpay the lender.
    function _denormalizeAmountCeil(address token, uint256 amount) internal view returns (uint256) {
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = 18;
        if (dec < 18) return amount.ceilDiv(10 ** (18 - dec));
        if (dec > 18) return amount * (10 ** (dec - 18));
        return amount;
    }

    function getHealthFactor(uint256 loanId) public view returns (uint256) {
        Loan memory loan = loans[loanId];
        require(!loan.repaid, "Loan already repaid");

        // For funded loans use actual debt (principal + accrued interest - repaid).
        // For unfunded loans use requestedPrincipalAmount — no interest accrues yet.
        uint256 remainingDebt;
        if (loan.funded) {
            uint256 totalDue = loan.principalAmount + _currentInterestOwed(loan);
            remainingDebt = totalDue > loan.amountRepaid ? totalDue - loan.amountRepaid : 0;
        } else {
            remainingDebt = loan.requestedPrincipalAmount;
        }
        require(remainingDebt > 0, "No remaining debt");

        uint256 lockedCollateral = loan.collateralAmount - loan.collateralReleased;

        uint256 collateralPrice = _getPrice(loan.collateralToken);
        uint256 principalPrice  = _getPrice(loan.requestedPrincipalToken);

        // Normalize both amounts to 18 decimals before USD multiplication,
        // so that mismatched token decimals (e.g. ETH 18 vs USDC 6) don't skew the ratio.
        uint256 normalizedCollateral = _normalizeAmount(loan.collateralToken, lockedCollateral);
        uint256 normalizedDebt       = _normalizeAmount(loan.requestedPrincipalToken, remainingDebt);

        // Prices are 1e18-scaled USD per token-unit. Both amount and price are
        // already ~1e18-scale, so a plain amount * price intermediate is ~1e36 and
        // can exceed uint256 for a sufficiently large deposit/price combination
        // even though the real-world USD value is always representable. mulDiv
        // divides by 1e18 in the same step, so the ~1e36 intermediate this
        // produces internally uses 512-bit precision and never needs to fit in
        // uint256 on its own — only the final (properly 1e18-scaled) result does.
        uint256 lockedCollateralUSD = normalizedCollateral.mulDiv(collateralPrice, 1e18);
        uint256 remainingDebtUSD    = normalizedDebt.mulDiv(principalPrice, 1e18);

        // Loans created before this field was appended to the struct read 0 here
        // (Solidity's default for an unset slot). Without this fallback, such a
        // legacy loan's health factor would always compute to 0 — permanently
        // "Liquidation Risk" in the UI and permanently eligible for liquidate(),
        // regardless of actual collateralization. Default to 10000 (100% max LTV,
        // the most permissive/safe interpretation) rather than treating unset as
        // always-liquidatable. Mirrors the same 0-means-unset pattern already used
        // for tokenDecimals in _normalizeAmount.
        uint16 effectiveThresholdBps = loan.liquidationThresholdBps == 0
            ? 10000
            : loan.liquidationThresholdBps;

        // healthFactor is scaled to 1e18; >= 1e18 means healthy.
        // Same reasoning applies here: lockedCollateralUSD * liquidationThresholdBps
        // * 1e18 before dividing can exceed uint256 as a plain intermediate for
        // large enough loans, even though the final ratio is always small. Divide
        // by remainingDebtUSD and by 10000 as two separate mulDiv steps rather than
        // combining them into one remainingDebtUSD * 10000 denominator — that
        // combined denominator is itself a plain multiplication computed *before*
        // being passed into mulDiv, so it isn't protected by mulDiv's internal
        // 512-bit precision the way the numerator's product is.
        uint256 thresholdScaled = uint256(effectiveThresholdBps) * 1e18;
        uint256 ratio = lockedCollateralUSD.mulDiv(thresholdScaled, remainingDebtUSD);
        return ratio / 10000;
    }

    /**
     * @notice Liquidate an undercollateralized or expired ETH-principal loan.
     * @dev    Send at least the computed liquidatorPays as msg.value; any surplus is refunded
     *         to msg.sender. Seized collateral is sent to `collateralRecipient`
     *         (address(0) defaults to msg.sender — useful for bots routing to a treasury).
     * @param collateralRecipient Address to receive the seized collateral, or address(0) for msg.sender.
     */
    function liquidate(uint256 loanId, address collateralRecipient) external payable nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.requestedPrincipalToken == address(0), "Loan has ERC20 principal; use liquidateWithERC20");
        _liquidate(loan, loanId, msg.value, collateralRecipient == address(0) ? msg.sender : collateralRecipient);
    }

    /**
     * @notice Liquidate an undercollateralized or expired ERC20-principal loan.
     * @dev    Pulls exactly the computed liquidatorPays (≤ maxAmount) via transferFrom.
     *         Seized collateral is sent to `collateralRecipient`
     *         (address(0) defaults to msg.sender — useful for bots routing to a treasury).
     * @param loanId              The loan to liquidate.
     * @param maxAmount           Maximum the caller is willing to pay (slippage guard).
     * @param collateralRecipient Address to receive the seized collateral, or address(0) for msg.sender.
     */
    function liquidateWithERC20(uint256 loanId, uint256 maxAmount, address collateralRecipient) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.requestedPrincipalToken != address(0), "Loan has ETH principal; use liquidate");
        _liquidate(loan, loanId, maxAmount, collateralRecipient == address(0) ? msg.sender : collateralRecipient);
    }

    struct LiquidationAmounts {
        uint256 liquidatorPays;
        uint256 seizeCollateral;
        uint256 collateralReturned;
        uint256 interestOutstanding;
    }

    /**
     * @dev Compute seizure and payment amounts for a liquidation.
     *      Extracted to avoid stack-too-deep in _liquidate.
     */
    function _liquidationAmounts(
        Loan storage loan,
        uint256 debt,
        uint256 lockedCollateral
    ) internal view returns (LiquidationAmounts memory r) {
        r.interestOutstanding = loan.interestAccrued > (loan.amountRepaid - loan.principalRepaid)
            ? loan.interestAccrued - (loan.amountRepaid - loan.principalRepaid) : 0;

        uint256 collateralPrice = _getPrice(loan.collateralToken);
        uint256 principalPrice  = _getPrice(loan.requestedPrincipalToken);

        // Target: collateral units worth debt*(1+bonus).
        uint256 targetCollateral = _denormalizeAmount(
            loan.collateralToken,
            _normalizeAmount(loan.requestedPrincipalToken, debt)
                .mulDiv(principalPrice, 1e18)
                .mulDiv(10000 + liquidationBonusBps, 10000)
                .mulDiv(1e18, collateralPrice)
        );

        if (targetCollateral <= lockedCollateral) {
            // Healthy close: liquidator pays full debt, seizes target, borrower gets the rest.
            r.liquidatorPays     = debt;
            r.seizeCollateral    = targetCollateral;
            r.collateralReturned = lockedCollateral - targetCollateral;
        } else {
            // Underwater: seize all collateral, liquidator pays collateralValue/(1+bonus).
            r.seizeCollateral    = lockedCollateral;
            r.collateralReturned = 0;
            // Round up so the liquidator always pays at least as much as the collateral is worth;
            // rounding down (floor) for tokens with <18 decimals (e.g. USDC) would undercharge
            // the liquidator and leave the lender short.
            uint256 pay = _denormalizeAmountCeil(
                loan.requestedPrincipalToken,
                _normalizeAmount(loan.collateralToken, lockedCollateral)
                    .mulDiv(collateralPrice, 1e18)
                    .mulDiv(10000, 10000 + liquidationBonusBps)
                    .mulDiv(1e18, principalPrice)
            );
            r.liquidatorPays = pay > debt ? debt : pay;
        }
    }

    /**
     * @dev Core liquidation logic shared by both entry points.
     *      maxPay is msg.value (ETH) or maxAmount (ERC20) — the caller's ceiling.
     *      collateralRecipient is the resolved recipient (never address(0) by the time it reaches here).
     */
    function _liquidate(Loan storage loan, uint256 loanId, uint256 maxPay, address collateralRecipient) internal {
        require(loan.funded,   "Loan is not funded");
        require(!loan.repaid,  "Loan already repaid");
        require(loan.active,   "Loan is not active");

        _accrue(loan);

        bool expired = loan.durationSeconds > 0
            && block.timestamp > loan.fundedAt + loan.durationSeconds;
        // getHealthFactor calls _getPrice (staleness-checked). If the loan is expired we skip the
        // health-factor check here to establish liquidatability, but liquidation still needs fresh
        // oracle prices later in _liquidationAmounts to compute payouts, so expired liquidations
        // will still revert on stale feeds.
        bool undercollateralized = !expired && getHealthFactor(loanId) < 1e18;
        require(undercollateralized || expired, "Loan is not liquidatable");

        uint256 debt = (loan.principalAmount - loan.principalRepaid)
            + (loan.interestAccrued > (loan.amountRepaid - loan.principalRepaid)
               ? loan.interestAccrued - (loan.amountRepaid - loan.principalRepaid) : 0);

        uint256 lockedCollateral = loan.collateralAmount - loan.collateralReleased;

        LiquidationAmounts memory a = _liquidationAmounts(loan, debt, lockedCollateral);

        require(a.liquidatorPays <= maxPay, "Exceeds max payment");

        // Protocol fee only on healthy close; waived when underwater (lender keeps full payment).
        uint256 protocolFee = a.liquidatorPays == debt ? _protocolFee(a.interestOutstanding) : 0;

        // For principalRepaid tracking: on healthy close, credit principal repaid above interest.
        uint256 principalPaid = (a.liquidatorPays == debt && a.liquidatorPays > a.interestOutstanding)
            ? a.liquidatorPays - a.interestOutstanding : 0;

        // Collect ERC20 payment (exact amount). ETH already held via msg.value.
        if (loan.requestedPrincipalToken != address(0)) {
            uint256 balanceBefore = IERC20(loan.requestedPrincipalToken).balanceOf(address(this));
            IERC20(loan.requestedPrincipalToken).safeTransferFrom(msg.sender, address(this), a.liquidatorPays);
            require(
                IERC20(loan.requestedPrincipalToken).balanceOf(address(this)) - balanceBefore == a.liquidatorPays,
                "Fee-on-transfer principal not supported"
            );
        }

        // Update state — loan fully closed.
        loan.amountRepaid      += a.liquidatorPays;
        loan.principalRepaid   += principalPaid;
        loan.collateralReleased = loan.collateralAmount;
        loan.repaid            = true;
        loan.active            = false;
        loan.collateralLocked  = false;

        // --- Payouts ---

        // Lender receives liquidatorPays minus protocol fee.
        if (loan.requestedPrincipalToken == address(0)) {
            _payoutEth(loan.lender, a.liquidatorPays - protocolFee);
        } else {
            _payoutToken(loan.requestedPrincipalToken, loan.lender, a.liquidatorPays - protocolFee);
        }

        if (protocolFee > 0) {
            if (loan.requestedPrincipalToken == address(0)) {
                _payoutEth(protocolTreasury, protocolFee);
            } else {
                _payoutToken(loan.requestedPrincipalToken, protocolTreasury, protocolFee);
            }
            emit ProtocolFeeCollected(loanId, loan.requestedPrincipalToken, protocolFee);
        }

        // Collateral: recipient seizes, borrower gets any excess.
        if (loan.collateralToken == address(0)) {
            lockedEthCollateral[loan.borrower] -= lockedCollateral;
            (bool ok, ) = payable(collateralRecipient).call{value: a.seizeCollateral}("");
            if (!ok) _creditPayment(collateralRecipient, address(0), a.seizeCollateral);
            if (a.collateralReturned > 0) _payoutEth(loan.borrower, a.collateralReturned);
        } else {
            IERC20(loan.collateralToken).safeTransfer(collateralRecipient, a.seizeCollateral);
            if (a.collateralReturned > 0) {
                IERC20(loan.collateralToken).safeTransfer(loan.borrower, a.collateralReturned);
            }
        }

        // Refund surplus ETH to liquidator (ETH-principal only).
        if (loan.requestedPrincipalToken == address(0) && maxPay > a.liquidatorPays) {
            _payoutEth(msg.sender, maxPay - a.liquidatorPays);
        }

        emit LoanLiquidated(loanId, msg.sender, a.liquidatorPays, a.seizeCollateral, a.collateralReturned, block.timestamp);
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
        // ETH-only; ERC20 collateral has no common unit — use getLoanLockedCollateral instead.
        // Return collateral still locked (original minus what partial repayments have released).
        return loan.collateralToken == address(0) ? loan.collateralAmount - loan.collateralReleased : 0;
    }

    function getLoanLockedCollateral(uint256 loanId) external view returns (
        address collateralToken,
        uint256 collateralAmount,
        bool locked
    ) {
        Loan memory loan = loans[loanId];
        // collateralAmount reflects what remains locked after any partial releases, not the original deposit.
        return (loan.collateralToken, loan.collateralAmount - loan.collateralReleased, loan.collateralLocked);
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

    /// @notice Total interest charged so far on the OUTSTANDING principal, plus any origination floor.
    /// @dev View-only mirror of `_accrue`: returns crystallized interest (`interestAccrued`) plus the
    ///      whole-day interest pending since `lastAccrualAt`, computed on the current outstanding
    ///      principal and capped at the loan duration. Used by views; repayment uses `_accrue`.
    function _currentInterestOwed(Loan memory loan) internal view returns (uint256) {
        if (!loan.funded) return 0;
        uint256 owed = loan.interestAccrued;
        if (loan.durationSeconds == 0) return owed; // floor only; no time-based interest
        uint256 from = loan.lastAccrualAt == 0 ? loan.fundedAt : loan.lastAccrualAt;
        uint256 dueAt = loan.fundedAt + loan.durationSeconds;
        uint256 cappedNow = block.timestamp < dueAt ? block.timestamp : dueAt;
        if (cappedNow > from) {
            uint256 periods = (cappedNow - from) / ACCRUAL_PERIOD;
            uint256 outstanding = loan.principalAmount - loan.principalRepaid;
            owed += (outstanding * loan.interestRateBps * periods) / (10000 * PERIODS_PER_YEAR);
        }
        return owed;
    }

    /// @notice Crystallize interest accrued on the current outstanding principal up to now.
    /// @dev Advances `lastAccrualAt` only by whole elapsed days so the sub-day remainder carries
    ///      forward (frequent payments cannot dodge interest). Interest is charged on the
    ///      outstanding balance (principal - principalRepaid), so repaying principal lowers future
    ///      accrual. No-op once the duration cap is reached or for unfunded / zero-duration loans.
    function _accrue(Loan storage loan) internal {
        if (!loan.funded || loan.durationSeconds == 0) return;
        if (loan.lastAccrualAt == 0) loan.lastAccrualAt = loan.fundedAt;
        uint256 from = loan.lastAccrualAt;
        uint256 dueAt = loan.fundedAt + loan.durationSeconds;
        uint256 cappedNow = block.timestamp < dueAt ? block.timestamp : dueAt;
        if (cappedNow <= from) return;
        uint256 periods = (cappedNow - from) / ACCRUAL_PERIOD;
        if (periods == 0) return; // preserve the remainder toward the next whole day
        uint256 outstanding = loan.principalAmount - loan.principalRepaid;
        loan.interestAccrued += (outstanding * loan.interestRateBps * periods) / (10000 * PERIODS_PER_YEAR);
        loan.lastAccrualAt = from + periods * ACCRUAL_PERIOD;
    }

    /**
     * @notice Returns repayment-related details for a loan.
     * @return interestRateBps  Agreed ANNUAL interest rate in basis points.
     * @return durationSeconds  Agreed loan duration in seconds (0 = no deadline).
     * @return repaid           Whether the loan has been fully repaid.
     * @return totalDue         Principal + accrued interest owed right now (0 if not funded).
     * @return amountRepaid     Cumulative amount repaid so far.
     * @return remaining        Amount still outstanding right now.
     * @return fundDeadline     Timestamp after which the loan can no longer be funded.
     */
    function getRepaymentDetails(uint256 loanId) external view returns (
        uint16 interestRateBps,
        uint256 durationSeconds,
        bool repaid,
        uint256 totalDue,
        uint256 amountRepaid,
        uint256 remaining,
        uint256 fundDeadline
    ) {
        Loan memory loan = loans[loanId];
        uint256 due = loan.repaid
            ? loan.amountRepaid
            : loan.funded ? loan.principalAmount + _currentInterestOwed(loan) : 0;
        return (
            loan.interestRateBps,
            loan.durationSeconds,
            loan.repaid,
            due,
            loan.amountRepaid,
            due > loan.amountRepaid ? due - loan.amountRepaid : 0,
            loan.fundDeadline
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

    // --- EIP-712 domain ---

    function _EIP712Name() internal pure override returns (string memory) { return "Vouch"; }
    function _EIP712Version() internal pure override returns (string memory) { return "1"; }

    // --- Signed order hash functions ---

    function hashLoanRequest(SignedLoanRequest calldata req) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            LOAN_REQUEST_TYPEHASH, req.borrower, req.collateralToken, req.collateralAmount,
            req.principalToken, req.principalAmount, req.interestRateBps, req.durationSeconds,
            req.maxLtvBps, req.nonce, req.deadline
        )));
    }

    function hashLendOffer(SignedLendOffer calldata offer) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            LEND_OFFER_TYPEHASH, offer.lender, offer.principalToken, offer.principalAmount,
            offer.collateralRatioBps, offer.trustedRatioBps, offer.scoreThreshold,
            offer.maxLtvBps, offer.interestRateBps, offer.durationSeconds, offer.nonce, offer.deadline
        )));
    }
}
