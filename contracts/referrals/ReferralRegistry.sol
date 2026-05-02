// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ReferralRegistry
/// @notice Stores a one-time, immutable mapping from a user address to the
///         referrer that brought them to the platform. Read by `SplitsManager`
///         when minting a per-course splitter so that a small slice of every
///         USDC sale flows back to the referrer for as long as the referred
///         user keeps buying.
/// @dev Self-referrals and the zero address are rejected so callers can rely
///      on `referrerOf(user) != user` and `referrerOf(user) != address(0)` if
///      `hasReferrer(user)` is true.
contract ReferralRegistry {
    /// @dev Internal storage; consumers should use `referrerOf` for clarity.
    mapping(address => address) private _referrer;

    /// @notice Emitted exactly once per user when they bind a referrer.
    event ReferrerSet(address indexed user, address indexed referrer);

    error ReferrerAlreadySet();
    error InvalidReferrer();

    /// @notice Bind `referrer` as the referrer for `msg.sender`. May only be
    ///         called once per user. Subsequent attempts revert with
    ///         {ReferrerAlreadySet} so educators / referrers cannot poach
    ///         each other's downstream after the first sale.
    /// @param referrer The address to credit on future referred sales.
    function setReferrer(address referrer) external {
        if (referrer == address(0) || referrer == msg.sender) revert InvalidReferrer();
        if (_referrer[msg.sender] != address(0)) revert ReferrerAlreadySet();
        _referrer[msg.sender] = referrer;
        emit ReferrerSet(msg.sender, referrer);
    }

    /// @notice Returns the referrer bound to `user`, or `address(0)` if none.
    function referrerOf(address user) external view returns (address) {
        return _referrer[user];
    }

    /// @notice Convenience predicate.
    function hasReferrer(address user) external view returns (bool) {
        return _referrer[user] != address(0);
    }
}
