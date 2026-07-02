// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVouchVaultFunder {
    function fundLoan(uint256 loanId) external payable;
    function withdrawPayments(address token) external;
}

/// @title RejectingLender (test helper)
/// @notice A lender contract that can fund an ETH-principal loan but rejects any ETH
///         sent directly to it. Used to prove the vault uses pull-over-push payouts:
///         a recipient that reverts on receipt must never be able to block a
///         borrower's repayment.
contract RejectingLender {
    /// @notice Fund an ETH-principal loan on behalf of this contract.
    function fund(address vault, uint256 loanId) external payable {
        IVouchVaultFunder(vault).fundLoan{value: msg.value}(loanId);
    }

    /// @notice Attempt to pull credited funds (will revert for ETH because this
    ///         contract has no receive/fallback).
    function claim(address vault, address token) external {
        IVouchVaultFunder(vault).withdrawPayments(token);
    }

    // Intentionally no receive()/fallback(): any direct ETH transfer reverts.
}
