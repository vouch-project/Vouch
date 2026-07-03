// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockV3Aggregator {
    uint8 public decimals;
    int256 public latestAnswer;
    uint256 public updatedAt;
    // When true, latestRoundData reports answeredInRound < roundId — simulating a
    // carried-over stale round (e.g. during a real aggregator outage) for tests.
    bool public staleRound;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        latestAnswer = _initialAnswer;
        updatedAt = block.timestamp;
    }

    function updateAnswer(int256 _answer) external {
        latestAnswer = _answer;
        updatedAt = block.timestamp;
    }

    function setStaleRound(bool _staleRound) external {
        staleRound = _staleRound;
    }

    // Lets tests simulate a misconfigured/malicious feed reporting a timestamp
    // in the future, without waiting for real time to catch up.
    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    // Lets tests simulate a misconfigured/malicious feed reporting decimals
    // outside the range VouchVault._getPrice expects.
    function setDecimals(uint8 _decimals) external {
        decimals = _decimals;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound
    ) {
        return (2, latestAnswer, updatedAt, updatedAt, staleRound ? 1 : 2);
    }
}
