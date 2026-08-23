// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { VouchVault } from "./VouchVault.sol";

/// @notice Read-only helper for VouchVault view queries. Keeps the main contract under the 24 576-byte limit.
contract VouchVaultLens {
    VouchVault public immutable vault;

    uint256 private constant ACCRUAL_PERIOD = 86400;
    uint256 private constant PERIODS_PER_YEAR = 365;

    error InvalidAddress();

    constructor(address _vault) {
        if (_vault == address(0)) revert InvalidAddress();
        vault = VouchVault(_vault);
    }

    function _currentInterestOwed(VouchVault.Loan memory loan) internal view returns (uint256) {
        if (!loan.funded) return 0;
        uint256 owed = loan.interestAccrued;
        if (loan.durationSeconds == 0) return owed;
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

    function balanceOf(address user) external view returns (uint256) {
        return vault.deposits(user);
    }

    function lockedBalanceOf(address user) external view returns (uint256) {
        return vault.lockedEthCollateral(user);
    }

    function loanLockedBalanceOf(uint256 loanId) external view returns (uint256) {
        VouchVault.Loan memory loan = vault.getLoanRaw(loanId);
        return loan.collateralToken == address(0) ? loan.collateralAmount - loan.collateralReleased : 0;
    }

    function getLoanLockedCollateral(uint256 loanId) external view returns (
        address collateralToken,
        uint256 collateralAmount,
        bool locked
    ) {
        VouchVault.Loan memory loan = vault.getLoanRaw(loanId);
        return (loan.collateralToken, loan.collateralAmount - loan.collateralReleased, loan.collateralLocked);
    }

    function getLoan(uint256 loanId) external view returns (
        address borrower,
        address collateralToken,
        uint256 collateralAmount,
        uint256 createdAt,
        bool active
    ) {
        VouchVault.Loan memory loan = vault.getLoanRaw(loanId);
        return (loan.borrower, loan.collateralToken, loan.collateralAmount, loan.createdAt, loan.active);
    }

    function getFundingDetails(uint256 loanId) external view returns (
        address lender,
        uint256 principalAmount,
        bool funded,
        uint256 fundedAt
    ) {
        VouchVault.Loan memory loan = vault.getLoanRaw(loanId);
        return (loan.lender, loan.principalAmount, loan.funded, loan.fundedAt);
    }

    function getRepaymentDetails(uint256 loanId) external view returns (
        uint16 interestRateBps,
        uint256 durationSeconds,
        bool repaid,
        uint256 totalDue,
        uint256 amountRepaid,
        uint256 remaining,
        uint256 fundDeadline
    ) {
        VouchVault.Loan memory loan = vault.getLoanRaw(loanId);
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

    function getHealthFactor(uint256 loanId) external view returns (uint256) {
        return vault.getHealthFactor(loanId);
    }
}
