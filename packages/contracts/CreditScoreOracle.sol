// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CreditScoreOracle
 * @notice Oracle contract for storing and retrieving credit scores from ML service
 * @dev In production, this would integrate with Chainlink or a custom oracle solution
 */
contract CreditScoreOracle is Ownable {
    // Credit score data
    struct CreditScore {
        uint256 score;
        uint256 timestamp;
        bool exists;
    }

    // Mapping from wallet address to credit score
    mapping(address => CreditScore) public creditScores;

    // Authorized updaters (off-chain services)
    mapping(address => bool) public authorizedUpdaters;

    // Events
    event CreditScoreUpdated(address indexed wallet, uint256 score, uint256 timestamp);
    event UpdaterAuthorized(address indexed updater);
    event UpdaterRevoked(address indexed updater);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Update credit score for a wallet
     * @param wallet Address of the wallet
     * @param score Credit score value (300-850)
     */
    function updateCreditScore(address wallet, uint256 score) external {
        require(authorizedUpdaters[msg.sender], "Not authorized");
        require(score >= 300 && score <= 850, "Invalid score range");

        creditScores[wallet] = CreditScore({
            score: score,
            timestamp: block.timestamp,
            exists: true
        });

        emit CreditScoreUpdated(wallet, score, block.timestamp);
    }

    /**
     * @notice Get credit score for a wallet
     * @param wallet Address of the wallet
     * @return score Credit score value
     * @return timestamp When the score was last updated
     */
    function getCreditScore(address wallet) external view returns (uint256 score, uint256 timestamp) {
        require(creditScores[wallet].exists, "Credit score not found");
        return (creditScores[wallet].score, creditScores[wallet].timestamp);
    }

    /**
     * @notice Check if a credit score exists for a wallet
     * @param wallet Address of the wallet
     * @return Boolean indicating if score exists
     */
    function hasCreditScore(address wallet) external view returns (bool) {
        return creditScores[wallet].exists;
    }

    /**
     * @notice Authorize an address to update credit scores
     * @param updater Address to authorize
     */
    function authorizeUpdater(address updater) external onlyOwner {
        authorizedUpdaters[updater] = true;
        emit UpdaterAuthorized(updater);
    }

    /**
     * @notice Revoke authorization from an updater
     * @param updater Address to revoke
     */
    function revokeUpdater(address updater) external onlyOwner {
        authorizedUpdaters[updater] = false;
        emit UpdaterRevoked(updater);
    }
}
