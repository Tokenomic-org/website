// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {RoleRegistry} from "../registries/RoleRegistry.sol";
import {SplitsManager} from "../splits/SplitsManager.sol";

/// @title CourseAccess1155
/// @notice Soulbound ERC-1155 representing per-course access tokens. Each
///         token id corresponds to one course; balance == 1 means the holder
///         has paid for access. Tokens are minted only via {purchase}, are
///         non-transferable, and route the buyer's USDC payment through a
///         per-(educator, buyer) splitter created on the fly via
///         {SplitsManager}.
/// @dev Soulbound enforcement is implemented in `_update` (OZ v5 hook) so it
///      catches transfers, batch transfers, and approvals-routed transfers
///      uniformly. Mints (`from == 0`) and burns (`to == 0`) are still allowed.
contract CourseAccess1155 is ERC1155, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Course {
        address educator;       // EDUCATOR_ROLE author of the course
        uint256 priceUSDC;      // 6-decimal USDC price
        uint32  educatorBps;    // 1e6 bps (e.g. 900_000 = 90%)
        uint32  referrerBps;    // 1e6 bps
        uint32  platformBps;    // 1e6 bps
        bool    active;         // togglable kill-switch
        bool    exists;
    }

    /// @notice Role registry (source of truth for EDUCATOR_ROLE / PLATFORM_ROLE).
    RoleRegistry public immutable roles;

    /// @notice 0xSplits-backed router for revenue.
    SplitsManager public immutable splits;

    /// @notice Stablecoin used for payments (USDC on Base).
    IERC20 public immutable usdc;

    /// @notice Auto-incrementing course id (token id). Starts at 1.
    uint256 public nextCourseId = 1;

    /// @notice Course registry keyed by token id.
    mapping(uint256 => Course) public courses;

    /// @notice IPFS-style metadata URI per course id.
    mapping(uint256 => string)  private _courseURI;

    event CourseCreated(
        uint256 indexed courseId,
        address indexed educator,
        uint256 priceUSDC,
        uint32 educatorBps,
        uint32 referrerBps,
        uint32 platformBps,
        string metadataURI
    );
    event CourseUpdated(uint256 indexed courseId, uint256 priceUSDC, bool active);
    event CoursePurchased(
        uint256 indexed courseId,
        address indexed buyer,
        address indexed split,
        uint256 priceUSDC
    );

    error NotEducator();
    error NotPlatform();
    error InvalidPrice();
    error InvalidBps();
    error CourseNotFound();
    error CourseInactive();
    error AlreadyOwned();
    error SoulboundTransfer();
    error InvalidURI();

    modifier onlyEducator() {
        if (!roles.hasRole(roles.EDUCATOR_ROLE(), msg.sender)) revert NotEducator();
        _;
    }

    modifier onlyPlatform() {
        if (!roles.hasRole(roles.PLATFORM_ROLE(), msg.sender)) revert NotPlatform();
        _;
    }

    constructor(RoleRegistry _roles, SplitsManager _splits, IERC20 _usdc) ERC1155("") {
        require(address(_roles) != address(0) && address(_splits) != address(0) && address(_usdc) != address(0),
            "CourseAccess1155: zero addr");
        roles = _roles;
        splits = _splits;
        usdc = _usdc;
    }

    // ---------- Educator surface ----------

    /// @notice Register a new course token. Caller becomes the educator.
    /// @param priceUSDC      Price in USDC base units (6 decimals on Base).
    /// @param educatorBps    Educator share (1e6 bps).
    /// @param referrerBps    Referrer share (1e6 bps).
    /// @param platformBps    Platform share (1e6 bps). Must sum to 1_000_000.
    /// @param metadataURI    Full ipfs:// (or https://) URI for the course JSON.
    /// @return courseId      Newly minted token id.
    function createCourse(
        uint256 priceUSDC,
        uint32 educatorBps,
        uint32 referrerBps,
        uint32 platformBps,
        string calldata metadataURI
    ) external onlyEducator returns (uint256 courseId) {
        if (priceUSDC == 0) revert InvalidPrice();
        if (uint256(educatorBps) + uint256(referrerBps) + uint256(platformBps) != splits.TOTAL_BPS()) revert InvalidBps();
        if (bytes(metadataURI).length == 0) revert InvalidURI();

        courseId = nextCourseId++;
        courses[courseId] = Course({
            educator: msg.sender,
            priceUSDC: priceUSDC,
            educatorBps: educatorBps,
            referrerBps: referrerBps,
            platformBps: platformBps,
            active: true,
            exists: true
        });
        _courseURI[courseId] = metadataURI;
        emit CourseCreated(courseId, msg.sender, priceUSDC, educatorBps, referrerBps, platformBps, metadataURI);
    }

    /// @notice Update price / active flag. Educator-only.
    function updateCourse(uint256 courseId, uint256 newPriceUSDC, bool active) external {
        Course storage c = courses[courseId];
        if (!c.exists) revert CourseNotFound();
        if (msg.sender != c.educator) revert NotEducator();
        if (newPriceUSDC == 0) revert InvalidPrice();
        c.priceUSDC = newPriceUSDC;
        c.active = active;
        emit CourseUpdated(courseId, newPriceUSDC, active);
    }

    /// @notice Platform escape-hatch (e.g. abuse takedown).
    function setActive(uint256 courseId, bool active) external onlyPlatform {
        Course storage c = courses[courseId];
        if (!c.exists) revert CourseNotFound();
        c.active = active;
        emit CourseUpdated(courseId, c.priceUSDC, active);
    }

    // ---------- Buyer surface ----------

    /// @notice Pay USDC for a course. Caller must have `approve`d this
    ///         contract for at least `priceUSDC` USDC. Buyer pays gas.
    /// @param courseId Course token id to purchase.
    function purchase(uint256 courseId) external nonReentrant returns (address split) {
        Course memory c = courses[courseId];
        if (!c.exists) revert CourseNotFound();
        if (!c.active) revert CourseInactive();
        if (balanceOf(msg.sender, courseId) > 0) revert AlreadyOwned();

        // Pull funds into this contract first (CEI).
        usdc.safeTransferFrom(msg.sender, address(this), c.priceUSDC);

        // Lazily ensure the per-(educator, buyer, bps) split exists, then
        // route the funds through it. The bps tuple is part of the cache key
        // (see {SplitsManager.splitOf}) so per-course economics are preserved
        // and pre-grief cannot affect a legitimate purchase.
        split = splits.getSplitFor(
            c.educator,
            msg.sender,
            c.educatorBps,
            c.referrerBps,
            c.platformBps
        );
        if (split == address(0)) {
            split = splits.createSplitFor(
                c.educator,
                msg.sender,
                c.educatorBps,
                c.referrerBps,
                c.platformBps
            );
        }
        usdc.forceApprove(address(splits), c.priceUSDC);
        splits.fundSplit(split, c.priceUSDC);
        // Immediately fan the funds out so each recipient (educator,
        // optional referrer, treasury) is credited in the same tx.
        // Recipients still pull-withdraw from SplitMain, which is the
        // 0xSplits convention.
        splits.distribute(split);

        _mint(msg.sender, courseId, 1, "");
        emit CoursePurchased(courseId, msg.sender, split, c.priceUSDC);
    }

    // ---------- Views ----------

    function uri(uint256 id) public view override returns (string memory) {
        return _courseURI[id];
    }

    function hasAccess(address user, uint256 courseId) external view returns (bool) {
        return balanceOf(user, courseId) > 0;
    }

    // ---------- Soulbound enforcement ----------

    /// @dev Block every non-mint, non-burn movement.
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) revert SoulboundTransfer();
        super._update(from, to, ids, values);
    }
}
