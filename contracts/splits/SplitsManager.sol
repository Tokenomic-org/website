// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {RoleRegistry} from "../registries/RoleRegistry.sol";
import {ReferralRegistry} from "../referrals/ReferralRegistry.sol";
import {ISplitMain} from "./ISplitMain.sol";

/// @title SplitsManager
/// @notice Thin wrapper around the audited 0xSplits `SplitMain` contract that
///         creates one immutable split per (educator, buyer) tuple and routes
///         USDC from {CourseAccess1155} into it. Splits are sized so that the
///         educator gets the majority share, an optional referrer (looked up
///         in {ReferralRegistry}) gets a configurable bps cut, and the
///         platform treasury collects whatever's left.
/// @dev We do **not** reinvent escrow / fan-out logic. SplitMain already does
///      that and is widely audited. Our job is bookkeeping + sorting.
contract SplitsManager {
    using SafeERC20 for IERC20;

    /// @dev 0xSplits uses 1e6-denominated bps (1_000_000 == 100%). All inputs
    ///      to this contract use the same denomination.
    uint32 public constant TOTAL_BPS = 1_000_000;

    /// @notice Authoritative role registry.
    RoleRegistry public immutable roles;

    /// @notice Read-only handle to the referral registry used at split-creation time.
    ReferralRegistry public immutable referrals;

    /// @notice 0xSplits SplitMain contract address (chain-specific).
    ISplitMain public immutable splitMain;

    /// @notice Stablecoin moved through the splits (USDC on Base).
    IERC20 public immutable usdc;

    /// @notice Treasury that receives the platform slice and fallback referrer slice.
    address public treasury;

    /// @notice Cached split address per (educator, buyer, bps tuple). Lets us
    ///         avoid re-creating the same immutable split on repeat purchases.
    /// @dev    key = keccak256(educator, buyer, eduBps, refBps, platBps).
    ///         Folding the bps into the cache key serves two goals:
    ///         (a) it preserves per-course economics — an educator with two
    ///             courses at different splits gets two different cached
    ///             splitters per buyer, instead of all courses being locked to
    ///             whichever bps purchased first; and
    ///         (b) it neutralises griefing — `createSplitFor` is permissionless
    ///             (any keeper / educator must be able to pre-warm a split),
    ///             but a griefer who pre-creates with bogus bps cannot affect
    ///             legitimate purchases because `purchase()` looks up the cache
    ///             entry that matches the *course-configured* bps.
    mapping(bytes32 => address) public splitOf;

    /// @notice Last-recorded recipient ordering for a given split, kept so that
    ///         `distribute()` can be called permissionlessly without the caller
    ///         needing to know the original sort order.
    mapping(address => address[])  private _accountsOf;
    mapping(address => uint32[])   private _allocationsOf;

    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event SplitCreated(
        address indexed educator,
        address indexed buyer,
        address indexed split,
        address[] accounts,
        uint32[] allocations
    );
    event SplitFunded(address indexed split, uint256 amount);
    event SplitDistributed(address indexed split, uint256 amount);

    error InvalidAddress();
    error InvalidBps();
    error UnknownSplit();
    error NotPlatform();

    modifier onlyPlatform() {
        if (!roles.hasRole(roles.PLATFORM_ROLE(), msg.sender)) revert NotPlatform();
        _;
    }

    constructor(
        RoleRegistry _roles,
        ReferralRegistry _referrals,
        ISplitMain _splitMain,
        IERC20 _usdc,
        address _treasury
    ) {
        if (
            address(_roles) == address(0) ||
            address(_referrals) == address(0) ||
            address(_splitMain) == address(0) ||
            address(_usdc) == address(0) ||
            _treasury == address(0)
        ) revert InvalidAddress();
        roles = _roles;
        referrals = _referrals;
        splitMain = _splitMain;
        usdc = _usdc;
        treasury = _treasury;
        emit TreasuryUpdated(address(0), _treasury);
    }

    /// @notice Update the treasury address. Restricted to PLATFORM_ROLE.
    function setTreasury(address newTreasury) external onlyPlatform {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Create (or return the cached address of) the per-(educator, buyer)
    ///         split. The buyer's referrer is looked up in {ReferralRegistry};
    ///         when no referrer is set, the referrer slice folds into the
    ///         platform slice.
    /// @param educator The educator who authored the course.
    /// @param buyer    The student paying for the course.
    /// @param eduBps   Educator allocation in 1e6 bps (e.g. 900_000 = 90%).
    /// @param refBps   Referrer allocation in 1e6 bps (e.g. 50_000 = 5%).
    /// @param platBps  Platform allocation in 1e6 bps (e.g. 50_000 = 5%).
    /// @return split   Address of the deployed (or cached) split contract.
    function createSplitFor(
        address educator,
        address buyer,
        uint32 eduBps,
        uint32 refBps,
        uint32 platBps
    ) external returns (address split) {
        if (educator == address(0) || buyer == address(0)) revert InvalidAddress();
        if (uint256(eduBps) + uint256(refBps) + uint256(platBps) != TOTAL_BPS) revert InvalidBps();

        bytes32 key = _splitKey(educator, buyer, eduBps, refBps, platBps);
        split = splitOf[key];
        if (split != address(0)) {
            return split;
        }

        address referrer = referrals.referrerOf(buyer);
        if (referrer == address(0) || referrer == educator) {
            // Roll referrer slice into the treasury share.
            platBps += refBps;
            refBps = 0;
            referrer = treasury;
        }

        (address[] memory accounts, uint32[] memory allocations) =
            _buildSortedRecipients(educator, referrer, treasury, eduBps, refBps, platBps);

        split = splitMain.createSplit(accounts, allocations, 0, address(0));
        splitOf[key] = split;
        _accountsOf[split] = accounts;
        _allocationsOf[split] = allocations;
        emit SplitCreated(educator, buyer, split, accounts, allocations);
    }

    /// @notice Forward `amount` USDC into `split` and emit a tracking event.
    ///         Caller must have `approve`d this contract for `amount` USDC.
    function fundSplit(address split, uint256 amount) external {
        if (split == address(0)) revert InvalidAddress();
        if (_accountsOf[split].length == 0) revert UnknownSplit();
        usdc.safeTransferFrom(msg.sender, split, amount);
        emit SplitFunded(split, amount);
    }

    /// @notice Permissionless trigger for SplitMain to fan funds out to the
    ///         per-recipient withdrawable balances. Anyone can call this; the
    ///         caller pays the gas (no distributor fee is configured).
    function distribute(address split) external {
        address[] memory accounts = _accountsOf[split];
        if (accounts.length == 0) revert UnknownSplit();
        uint32[] memory allocations = _allocationsOf[split];
        uint256 amount = usdc.balanceOf(split);
        splitMain.distributeERC20(split, address(usdc), accounts, allocations, 0, address(0));
        emit SplitDistributed(split, amount);
    }

    // ---------- Views ----------

    function getSplitRecipients(address split)
        external
        view
        returns (address[] memory accounts, uint32[] memory allocations)
    {
        accounts = _accountsOf[split];
        allocations = _allocationsOf[split];
    }

    /// @notice Look up the cached split address that matches a course's
    ///         configured bps tuple. Returns `address(0)` when no split has
    ///         been created for that exact tuple yet.
    function getSplitFor(
        address educator,
        address buyer,
        uint32 eduBps,
        uint32 refBps,
        uint32 platBps
    ) external view returns (address) {
        return splitOf[_splitKey(educator, buyer, eduBps, refBps, platBps)];
    }

    // ---------- Internal ----------

    /// @dev Cache key derivation. See `splitOf` natspec for the rationale
    ///      behind including bps in the key.
    function _splitKey(
        address educator,
        address buyer,
        uint32 eduBps,
        uint32 refBps,
        uint32 platBps
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(educator, buyer, eduBps, refBps, platBps));
    }

    /// @dev Builds the ascending-sorted recipient list required by 0xSplits.
    ///      Collapses duplicate addresses (e.g. educator == treasury) by
    ///      summing their allocations so SplitMain doesn't reject the call.
    function _buildSortedRecipients(
        address educator,
        address referrer,
        address treasuryAddr,
        uint32 eduBps,
        uint32 refBps,
        uint32 platBps
    ) internal pure returns (address[] memory accounts, uint32[] memory allocations) {
        // Stage everything in a fixed-size buffer first.
        address[3] memory rawAccounts = [educator, referrer, treasuryAddr];
        uint32[3]  memory rawAllocs   = [eduBps,  refBps,   platBps];

        // Collapse duplicates.
        uint256 unique = 0;
        address[3] memory uAccounts;
        uint32[3]  memory uAllocs;
        for (uint256 i = 0; i < 3; i++) {
            if (rawAllocs[i] == 0) continue;
            bool merged = false;
            for (uint256 j = 0; j < unique; j++) {
                if (uAccounts[j] == rawAccounts[i]) {
                    uAllocs[j] += rawAllocs[i];
                    merged = true;
                    break;
                }
            }
            if (!merged) {
                uAccounts[unique] = rawAccounts[i];
                uAllocs[unique]   = rawAllocs[i];
                unique++;
            }
        }

        // Insertion-sort the unique recipients ascending by address.
        for (uint256 i = 1; i < unique; i++) {
            address acc = uAccounts[i];
            uint32  bps = uAllocs[i];
            uint256 j = i;
            while (j > 0 && uAccounts[j - 1] > acc) {
                uAccounts[j] = uAccounts[j - 1];
                uAllocs[j]   = uAllocs[j - 1];
                j--;
            }
            uAccounts[j] = acc;
            uAllocs[j]   = bps;
        }

        accounts    = new address[](unique);
        allocations = new uint32[](unique);
        for (uint256 i = 0; i < unique; i++) {
            accounts[i]    = uAccounts[i];
            allocations[i] = uAllocs[i];
        }
    }
}
