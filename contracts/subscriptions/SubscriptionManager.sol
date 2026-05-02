// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {RoleRegistry} from "../registries/RoleRegistry.sol";

/// @title SubscriptionManager
/// @notice Pay-as-you-go monthly USDC subscription. Each call to {subscribe}
///         pulls one month's USDC and extends the subscriber's expiry by
///         {MONTH} seconds. {isActive} is the canonical view used by gating
///         contracts and the off-chain API to decide whether a wallet has an
///         active sub.
/// @dev Renewal compounds: paying mid-cycle stacks an extra month onto the
///      existing expiry rather than restarting from `block.timestamp`.
contract SubscriptionManager is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice 30-day month for predictable billing math.
    uint256 public constant MONTH = 30 days;

    /// @notice Role registry — PLATFORM_ROLE updates price / treasury.
    RoleRegistry public immutable roles;

    /// @notice Stablecoin (USDC on Base).
    IERC20 public immutable usdc;

    /// @notice Treasury that receives monthly payments.
    address public treasury;

    /// @notice Monthly price in USDC base units (6 decimals).
    uint256 public monthlyPriceUSDC;

    /// @notice expiresAt[user] — unix seconds at which the sub lapses.
    mapping(address => uint256) public expiresAt;

    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event PriceUpdated(uint256 previousPrice, uint256 newPrice);
    event Subscribed(address indexed subscriber, uint256 paid, uint256 newExpiry);

    error NotPlatform();
    error InvalidAddress();
    error InvalidPrice();

    modifier onlyPlatform() {
        if (!roles.hasRole(roles.PLATFORM_ROLE(), msg.sender)) revert NotPlatform();
        _;
    }

    constructor(RoleRegistry _roles, IERC20 _usdc, address _treasury, uint256 _monthlyPriceUSDC) {
        if (address(_roles) == address(0) || address(_usdc) == address(0) || _treasury == address(0)) {
            revert InvalidAddress();
        }
        if (_monthlyPriceUSDC == 0) revert InvalidPrice();
        roles = _roles;
        usdc = _usdc;
        treasury = _treasury;
        monthlyPriceUSDC = _monthlyPriceUSDC;
        emit TreasuryUpdated(address(0), _treasury);
        emit PriceUpdated(0, _monthlyPriceUSDC);
    }

    // ---------- Admin ----------

    function setTreasury(address newTreasury) external onlyPlatform {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setMonthlyPrice(uint256 newPrice) external onlyPlatform {
        if (newPrice == 0) revert InvalidPrice();
        emit PriceUpdated(monthlyPriceUSDC, newPrice);
        monthlyPriceUSDC = newPrice;
    }

    // ---------- Subscriber surface ----------

    /// @notice Pay one month of USDC and extend `msg.sender`'s subscription.
    ///         Caller must have `approve`d at least `monthlyPriceUSDC` first.
    /// @return newExpiry New unix expiry timestamp.
    function subscribe() external nonReentrant returns (uint256 newExpiry) {
        uint256 price = monthlyPriceUSDC;
        usdc.safeTransferFrom(msg.sender, treasury, price);
        uint256 base = expiresAt[msg.sender];
        if (base < block.timestamp) base = block.timestamp;
        newExpiry = base + MONTH;
        expiresAt[msg.sender] = newExpiry;
        emit Subscribed(msg.sender, price, newExpiry);
    }

    /// @notice Pre-pay multiple months in a single tx.
    /// @param months Number of months (must be >= 1).
    function subscribeMultiple(uint256 months) external nonReentrant returns (uint256 newExpiry) {
        require(months > 0, "SubscriptionManager: months=0");
        uint256 price = monthlyPriceUSDC * months;
        usdc.safeTransferFrom(msg.sender, treasury, price);
        uint256 base = expiresAt[msg.sender];
        if (base < block.timestamp) base = block.timestamp;
        newExpiry = base + MONTH * months;
        expiresAt[msg.sender] = newExpiry;
        emit Subscribed(msg.sender, price, newExpiry);
    }

    // ---------- Views ----------

    /// @notice Returns true iff `user` has not yet hit their expiry.
    function isActive(address user) external view returns (bool) {
        return expiresAt[user] > block.timestamp;
    }

    /// @notice Seconds remaining for `user`. Zero if expired.
    function remaining(address user) external view returns (uint256) {
        uint256 e = expiresAt[user];
        if (e <= block.timestamp) return 0;
        return e - block.timestamp;
    }
}
