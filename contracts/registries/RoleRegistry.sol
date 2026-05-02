// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title RoleRegistry
/// @notice Central role registry for the Tokenomic protocol on Base.
/// @dev Wraps OpenZeppelin v5 `AccessControl` and exposes named, well-known
///      role constants that the rest of the suite (CourseAccess1155,
///      CertificateNFT, SubscriptionManager, SplitsManager, etc.) reads via
///      `hasRole`. Keeping role administration in a single contract means we
///      never have to remember which contract a role lives on, and gives us
///      one canonical address to grant/revoke against in dashboards and
///      governance scripts.
contract RoleRegistry is AccessControl {
    /// @notice Educators publish courses, mint certificates, and receive the
    ///         majority share of every USDC payment.
    bytes32 public constant EDUCATOR_ROLE = keccak256("EDUCATOR_ROLE");

    /// @notice Platform operators — can pause individual contracts and update
    ///         protocol-level treasury / fee settings. Strictly less powerful
    ///         than `DEFAULT_ADMIN_ROLE`.
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    /// @notice Treasury managers — can withdraw the platform fee balance to a
    ///         configured treasury address. Held by the multisig in production.
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    /// @notice Emitted on construction so indexers can pin the initial admin
    ///         without an extra `RoleGranted` lookup.
    event RoleRegistryDeployed(address indexed admin);

    /// @param admin Receives `DEFAULT_ADMIN_ROLE`, `PLATFORM_ROLE`, and
    ///              `TREASURY_ROLE`. Should be a multisig in production.
    constructor(address admin) {
        require(admin != address(0), "RoleRegistry: admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PLATFORM_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
        emit RoleRegistryDeployed(admin);
    }

    /// @notice Convenience batch grant — only callable by the `EDUCATOR_ROLE`
    ///         admin (i.e. `DEFAULT_ADMIN_ROLE`). Useful for onboarding cohorts
    ///         of educators in a single tx.
    /// @param accounts Addresses to grant `EDUCATOR_ROLE` to.
    function grantEducators(address[] calldata accounts) external onlyRole(getRoleAdmin(EDUCATOR_ROLE)) {
        for (uint256 i = 0; i < accounts.length; i++) {
            _grantRole(EDUCATOR_ROLE, accounts[i]);
        }
    }

    /// @notice Helper view used by satellite contracts.
    function isEducator(address account) external view returns (bool) {
        return hasRole(EDUCATOR_ROLE, account);
    }
}
