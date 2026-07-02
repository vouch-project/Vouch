// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FailableERC20 (test helper)
/// @notice An ERC20 whose `transfer` can be toggled to revert, used to exercise the
///         vault's hybrid payout fall-back: when a direct payout fails, the vault must
///         credit the recipient for later withdrawal instead of reverting the repayment.
///         `transferFrom` is intentionally left working so the vault can still pull funds
///         in from the borrower.
contract FailableERC20 is ERC20 {
    bool public failTransfers;

    constructor() ERC20("Failable", "FAIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!failTransfers, "transfer disabled");
        return super.transfer(to, amount);
    }
}
