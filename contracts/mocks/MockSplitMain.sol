// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISplitMain} from "../splits/ISplitMain.sol";

/// @notice Test-only stand-in for the 0xSplits SplitMain contract.
/// @dev Each `createSplit` deploys a tiny `MockSplit` proxy whose only job is
///      to hold incoming ERC20 transfers. `distributeERC20` then pulls the
///      proxy's balance back and divides it across recipients pro-rata using
///      the same 1e6 bps denominator as the real SplitMain.
contract MockSplitMain is ISplitMain {
    uint32 public constant TOTAL_BPS = 1_000_000;

    event SplitCreated(address indexed split, address[] accounts, uint32[] allocations);
    event Distributed(address indexed split, address indexed token, uint256 amount);
    event Withdrawn(address indexed account, address indexed token, uint256 amount);

    /// @dev Per-(account, token) withdrawable balance accumulated by distribute calls.
    mapping(address => mapping(address => uint256)) public withdrawable;

    function createSplit(
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32, /* distributorFee */
        address /* controller */
    ) external returns (address split) {
        require(accounts.length == percentAllocations.length && accounts.length > 0, "Mock: lens");
        uint256 sum;
        for (uint256 i = 0; i < percentAllocations.length; i++) {
            sum += percentAllocations[i];
            if (i > 0) require(accounts[i] > accounts[i - 1], "Mock: unsorted");
        }
        require(sum == TOTAL_BPS, "Mock: bad bps");
        split = address(new MockSplit());
        emit SplitCreated(split, accounts, percentAllocations);
    }

    function distributeERC20(
        address split,
        address token,
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32, /* distributorFee */
        address /* distributorAddress */
    ) external {
        uint256 balance = IERC20(token).balanceOf(split);
        MockSplit(split).flush(token, address(this), balance);
        uint256 distributed;
        for (uint256 i = 0; i < accounts.length - 1; i++) {
            uint256 share = (balance * percentAllocations[i]) / TOTAL_BPS;
            withdrawable[accounts[i]][token] += share;
            distributed += share;
        }
        // Remainder to last recipient to absorb rounding dust.
        withdrawable[accounts[accounts.length - 1]][token] += (balance - distributed);
        emit Distributed(split, token, balance);
    }

    function withdraw(
        address account,
        uint256, /* withdrawETH */
        address[] calldata tokens
    ) external {
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 amount = withdrawable[account][tokens[i]];
            if (amount == 0) continue;
            withdrawable[account][tokens[i]] = 0;
            require(IERC20(tokens[i]).transfer(account, amount), "Mock: xfer");
            emit Withdrawn(account, tokens[i], amount);
        }
    }
}

/// @notice Minimal split wallet — holds tokens until SplitMain pulls them.
contract MockSplit {
    address public immutable splitMain;

    constructor() {
        splitMain = msg.sender;
    }

    function flush(address token, address to, uint256 amount) external {
        require(msg.sender == splitMain, "MockSplit: not main");
        require(IERC20(token).transfer(to, amount), "MockSplit: xfer");
    }
}
