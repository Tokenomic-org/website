// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ITokenomicCertificate {
    function mint(address to, uint256 courseId, string calldata ipfsURI) external returns (uint256);
}

/// @title TokenomicMarket
/// @notice USDC-priced course marketplace with 90/5/5 revenue split
///         (educator / consultant / platform).
///
/// @dev Gas Fee Responsibility:
///        - Educators / consultants pay gas for `registerCourse`, `withdrawUSDC`,
///          and any admin actions they perform.
///        - Students pay gas for `purchase` and for the separate
///          `claimCertificate` mint that follows. Certificate minting is
///          intentionally split from purchase so buyers control (and pay for)
///          NFT issuance themselves — no platform-sponsored mints.
contract TokenomicMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Basis points denominator (10_000 = 100%).
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant EDUCATOR_BPS    = 9_000; // 90%
    uint16 public constant CONSULTANT_BPS  = 500;   // 5%
    uint16 public constant PLATFORM_BPS    = 500;   // 5%

    struct Course {
        address educator;
        address consultant; // address(0) when none — share rolls to platform
        uint256 price;      // in USDC base units (6 decimals)
        bool active;
    }

    /// @notice Stablecoin used for payments (USDC on Base by default).
    IERC20 public immutable usdc;

    /// @notice Certificate NFT minted on every successful purchase.
    ITokenomicCertificate public certificate;

    /// @notice Course registry.
    mapping(uint256 => Course) public courses;

    /// @notice Course metadata (IPFS URI) for educator-registered courses.
    mapping(uint256 => string) public courseMetadataURI;

    /// @notice Auto-incrementing id used by `registerCourse` (starts at 1).
    uint256 public nextCourseId = 1;

    /// @notice All course ids registered through `registerCourse` (for indexing).
    uint256[] public registeredCourseIds;

    /// @notice Courses registered by a given educator address.
    mapping(address => uint256[]) public coursesByEducator;

    /// @notice Has a wallet already purchased a given course? (Prevents duplicate certs.)
    mapping(uint256 => mapping(address => bool)) public hasPurchased;

    /// @notice Certificate tokenId minted for (courseId, buyer) via `claimCertificate`.
    ///         0 means the buyer has purchased but not yet claimed.
    mapping(uint256 => mapping(address => uint256)) public certificateOf;

    /// @notice USDC credited to each address from purchases, claimable via `withdrawUSDC`.
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice Aggregate USDC earned per address (lifetime, including already-withdrawn).
    mapping(address => uint256) public totalEarned;

    /// @notice Platform fee balance (only owner can withdraw via `withdrawPlatformFees`).
    uint256 public platformBalance;

    event CourseAdded(uint256 indexed courseId, address indexed educator, address consultant, uint256 price);
    event CourseRegistered(
        uint256 indexed courseId,
        address indexed educator,
        address consultant,
        uint256 price,
        string ipfsMetadataURI
    );
    event CourseUpdated(uint256 indexed courseId, address educator, address consultant, uint256 price, bool active);
    event CertificateContractUpdated(address indexed previous, address indexed current);
    event CoursePurchased(
        uint256 indexed courseId,
        address indexed buyer,
        uint256 totalPaid,
        uint256 educatorAmount,
        uint256 consultantAmount,
        uint256 platformAmount,
        uint256 certificateTokenId
    );
    /// @notice Detailed purchase event for dashboard queries (includes participants + URI).
    event PurchaseSettled(
        uint256 indexed courseId,
        address indexed buyer,
        address indexed educator,
        address consultant,
        uint256 educatorAmount,
        uint256 consultantAmount,
        uint256 platformAmount,
        uint256 certificateTokenId,
        string ipfsMetadataURI
    );
    event Withdrawn(address indexed account, uint256 amount);
    event PlatformWithdrawn(address indexed to, uint256 amount);
    /// @notice Emitted when a buyer claims (mints) their certificate. Buyer pays the gas.
    event CertificateClaimed(
        uint256 indexed courseId,
        address indexed buyer,
        uint256 certificateTokenId,
        string ipfsMetadataURI
    );

    error CourseInactive();
    error CourseNotFound();
    error AlreadyPurchased();
    error InvalidAddress();
    error InvalidPrice();
    error InvalidShares();
    error CertificateNotSet();
    error NothingToWithdraw();
    error NotPurchased();
    error AlreadyClaimed();

    constructor(address initialOwner, address usdcAddress, address certificateAddress) Ownable(initialOwner) {
        if (usdcAddress == address(0)) revert InvalidAddress();
        usdc = IERC20(usdcAddress);
        // certificate may be set after deployment via setCertificate (allows order-independent deploys).
        if (certificateAddress != address(0)) {
            certificate = ITokenomicCertificate(certificateAddress);
            emit CertificateContractUpdated(address(0), certificateAddress);
        }
        // Compile-time sanity check on the static splits.
        if (EDUCATOR_BPS + CONSULTANT_BPS + PLATFORM_BPS != BPS_DENOMINATOR) revert InvalidShares();
    }

    // ---------- Admin ----------

    function setCertificate(address certificateAddress) external onlyOwner {
        if (certificateAddress == address(0)) revert InvalidAddress();
        emit CertificateContractUpdated(address(certificate), certificateAddress);
        certificate = ITokenomicCertificate(certificateAddress);
    }

    function addCourse(uint256 courseId, address educator, address consultant, uint256 price)
        external
        onlyOwner
    {
        if (educator == address(0)) revert InvalidAddress();
        if (price == 0) revert InvalidPrice();
        if (courses[courseId].educator != address(0)) revert("Course exists");
        courses[courseId] = Course({
            educator: educator,
            consultant: consultant,
            price: price,
            active: true
        });
        // Keep the self-service counter past any admin-inserted id so the two
        // paths can never collide.
        if (courseId >= nextCourseId) nextCourseId = courseId + 1;
        emit CourseAdded(courseId, educator, consultant, price);
    }

    function updateCourse(uint256 courseId, address educator, address consultant, uint256 price, bool active)
        external
        onlyOwner
    {
        Course storage c = courses[courseId];
        if (c.educator == address(0)) revert CourseNotFound();
        if (educator == address(0)) revert InvalidAddress();
        if (price == 0) revert InvalidPrice();
        c.educator = educator;
        c.consultant = consultant;
        c.price = price;
        c.active = active;
        emit CourseUpdated(courseId, educator, consultant, price, active);
    }

    // ---------- Educator self-service ----------

    /// @notice Permissionless course registration. Caller becomes the educator.
    /// @param ipfsMetadataURI  IPFS URI (ipfs://Qm...) pointing to the course metadata JSON.
    /// @param priceInUSDC      Price in USDC base units (6 decimals on Base).
    /// @param consultant       Optional revenue partner (use address(0) for none).
    /// @return courseId        Newly minted course id.
    function registerCourse(string calldata ipfsMetadataURI, uint256 priceInUSDC, address consultant)
        external
        returns (uint256 courseId)
    {
        if (priceInUSDC == 0) revert InvalidPrice();
        if (bytes(ipfsMetadataURI).length == 0) revert InvalidAddress();
        courseId = nextCourseId++;
        // Defense-in-depth: never overwrite an existing course slot.
        if (courses[courseId].educator != address(0)) revert("Course exists");
        courses[courseId] = Course({
            educator: msg.sender,
            consultant: consultant,
            price: priceInUSDC,
            active: true
        });
        courseMetadataURI[courseId] = ipfsMetadataURI;
        registeredCourseIds.push(courseId);
        coursesByEducator[msg.sender].push(courseId);
        emit CourseAdded(courseId, msg.sender, consultant, priceInUSDC);
        emit CourseRegistered(courseId, msg.sender, consultant, priceInUSDC, ipfsMetadataURI);
    }

    // ---------- Purchase ----------

    /// @notice Pay USDC for a course. Caller must have called `usdc.approve(market, price)` first.
    ///         Student pays the gas. The certificate NFT is **not** minted here — call
    ///         `claimCertificate(courseId, ipfsMetadataURI)` afterwards (also paid by the student).
    /// @param courseId          Course to purchase.
    function purchase(uint256 courseId)
        external
        nonReentrant
    {
        Course memory c = courses[courseId];
        if (c.educator == address(0)) revert CourseNotFound();
        if (!c.active) revert CourseInactive();
        if (hasPurchased[courseId][msg.sender]) revert AlreadyPurchased();

        hasPurchased[courseId][msg.sender] = true;

        // Pull funds first (checks-effects-interactions).
        usdc.safeTransferFrom(msg.sender, address(this), c.price);

        uint256 educatorAmount = (c.price * EDUCATOR_BPS) / BPS_DENOMINATOR;
        uint256 platformAmount = (c.price * PLATFORM_BPS) / BPS_DENOMINATOR;
        uint256 consultantAmount = c.price - educatorAmount - platformAmount; // remainder == 5% (or 0)

        // If no consultant, fold their share into the platform cut.
        if (c.consultant == address(0)) {
            platformAmount += consultantAmount;
            consultantAmount = 0;
        }

        // Credit balances rather than transferring inline. Educators / consultants
        // pull funds via `withdrawUSDC()`; the platform fee is retained on-contract
        // and only the owner may sweep it via `withdrawPlatformFees`.
        if (educatorAmount > 0) {
            pendingWithdrawals[c.educator] += educatorAmount;
            totalEarned[c.educator]      += educatorAmount;
        }
        if (consultantAmount > 0) {
            pendingWithdrawals[c.consultant] += consultantAmount;
            totalEarned[c.consultant]        += consultantAmount;
        }
        platformBalance += platformAmount;

        // certificateTokenId == 0 here; the buyer mints separately via `claimCertificate`.
        emit CoursePurchased(
            courseId,
            msg.sender,
            c.price,
            educatorAmount,
            consultantAmount,
            platformAmount,
            0
        );
        emit PurchaseSettled(
            courseId,
            msg.sender,
            c.educator,
            c.consultant,
            educatorAmount,
            consultantAmount,
            platformAmount,
            0,
            ""
        );
    }

    // ---------- Certificate claim (student-paid mint) ----------

    /// @notice Mint the certificate NFT for a course the caller has already purchased.
    ///         Student pays the gas; one mint per (courseId, buyer).
    /// @param courseId          Course the caller previously purchased.
    /// @param ipfsMetadataURI   `ipfs://...` URI for the lightweight cert metadata JSON.
    /// @return certificateTokenId Minted ERC-721 tokenId.
    function claimCertificate(uint256 courseId, string calldata ipfsMetadataURI)
        external
        nonReentrant
        returns (uint256 certificateTokenId)
    {
        if (!hasPurchased[courseId][msg.sender]) revert NotPurchased();
        if (certificateOf[courseId][msg.sender] != 0) revert AlreadyClaimed();
        if (address(certificate) == address(0)) revert CertificateNotSet();
        if (bytes(ipfsMetadataURI).length == 0) revert InvalidAddress();

        certificateTokenId = certificate.mint(msg.sender, courseId, ipfsMetadataURI);
        certificateOf[courseId][msg.sender] = certificateTokenId;

        emit CertificateClaimed(courseId, msg.sender, certificateTokenId, ipfsMetadataURI);
    }

    /// @notice Optional: educator may sponsor a batch of buyer mints (educator pays gas).
    ///         Useful for promotional or premium tiers; not used by the default flow.
    function mintCertificatesForBuyers(
        uint256 courseId,
        address[] calldata buyers,
        string[] calldata ipfsMetadataURIs
    ) external nonReentrant {
        Course memory c = courses[courseId];
        if (c.educator == address(0)) revert CourseNotFound();
        if (msg.sender != c.educator) revert InvalidAddress();
        if (address(certificate) == address(0)) revert CertificateNotSet();
        if (buyers.length != ipfsMetadataURIs.length) revert InvalidAddress();

        for (uint256 i = 0; i < buyers.length; i++) {
            address buyer = buyers[i];
            if (!hasPurchased[courseId][buyer]) continue;
            if (certificateOf[courseId][buyer] != 0) continue;
            if (bytes(ipfsMetadataURIs[i]).length == 0) continue;
            uint256 tid = certificate.mint(buyer, courseId, ipfsMetadataURIs[i]);
            certificateOf[courseId][buyer] = tid;
            emit CertificateClaimed(courseId, buyer, tid, ipfsMetadataURIs[i]);
        }
    }

    // ---------- Withdrawals ----------

    /// @notice Pull all USDC credited to the caller from prior purchases.
    function withdrawUSDC() external nonReentrant returns (uint256 amount) {
        amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Owner-only sweep of accumulated platform fees.
    function withdrawPlatformFees(address to) external onlyOwner nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert InvalidAddress();
        amount = platformBalance;
        if (amount == 0) revert NothingToWithdraw();
        platformBalance = 0;
        usdc.safeTransfer(to, amount);
        emit PlatformWithdrawn(to, amount);
    }

    // ---------- Views ----------

    function getCourse(uint256 courseId) external view returns (Course memory) {
        return courses[courseId];
    }

    function getCourseMetadataURI(uint256 courseId) external view returns (string memory) {
        return courseMetadataURI[courseId];
    }

    function getCoursesByEducator(address educator) external view returns (uint256[] memory) {
        return coursesByEducator[educator];
    }

    function getRegisteredCourseIds() external view returns (uint256[] memory) {
        return registeredCourseIds;
    }

    function registeredCoursesLength() external view returns (uint256) {
        return registeredCourseIds.length;
    }

    /// @notice Quote the split for a given price without mutating state.
    function quoteSplit(uint256 price, bool hasConsultant)
        external
        pure
        returns (uint256 educatorAmount, uint256 consultantAmount, uint256 platformAmount)
    {
        educatorAmount = (price * EDUCATOR_BPS) / BPS_DENOMINATOR;
        platformAmount = (price * PLATFORM_BPS) / BPS_DENOMINATOR;
        consultantAmount = price - educatorAmount - platformAmount;
        if (!hasConsultant) {
            platformAmount += consultantAmount;
            consultantAmount = 0;
        }
    }
}
