// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISplitMain
/// @notice Minimal interface to the 0xSplits `SplitMain` contract used by the
///         Tokenomic suite. Includes only the methods we exercise from
///         {SplitsManager}; the upstream contract has many more for predicate
///         splits, controller transfers, etc.
/// @dev Reference deployment on Base mainnet **and** Base Sepolia:
///      `0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE`.
interface ISplitMain {
    /// @notice Deploy an immutable split. Recipients **must** be sorted ascending.
    /// @param accounts          Sorted list of recipient addresses.
    /// @param percentAllocations Per-recipient allocation in 1e6-denominated bps
    ///                          (so 100% == 1_000_000). Must sum to exactly 1e6.
    /// @param distributorFee    Fee paid to whoever calls `distributeERC20` /
    ///                          `distributeETH`, in the same 1e6 bps unit.
    /// @param controller        `address(0)` for an immutable split (the only
    ///                          mode we use).
    /// @return split            Deterministic address of the new split contract.
    function createSplit(
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32 distributorFee,
        address controller
    ) external returns (address split);

    /// @notice Distribute the ERC20 balance currently held by `split` according
    ///         to the immutable allocations baked in at creation time.
    function distributeERC20(
        address split,
        address token,
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32 distributorFee,
        address distributorAddress
    ) external;

    /// @notice Pull the per-recipient ERC20 balance accumulated by prior
    ///         `distributeERC20` calls.
    function withdraw(
        address account,
        uint256 withdrawETH,
        address[] calldata tokens
    ) external;
}
