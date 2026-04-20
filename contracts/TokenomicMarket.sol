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
/// @notice USDC-priced course marketplace with automatic 90/5/5 revenue split
///         (educator / consultant / platform) and atomic certificate minting.
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

    /// @notice Has a wallet already purchased a given course? (Prevents duplicate certs.)
    mapping(uint256 => mapping(address => bool)) public hasPurchased;

    event CourseAdded(uint256 indexed courseId, address indexed educator, address consultant, uint256 price);
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

    error CourseInactive();
    error CourseNotFound();
    error AlreadyPurchased();
    error InvalidAddress();
    error InvalidPrice();
    error InvalidShares();
    error CertificateNotSet();

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

    // ---------- Purchase ----------

    /// @notice Pay USDC for a course. Caller must have called `usdc.approve(market, price)` first.
    /// @param courseId          Course to purchase.
    /// @param ipfsMetadataURI   IPFS URI of the certificate metadata to mint for the buyer.
    function purchase(uint256 courseId, string calldata ipfsMetadataURI)
        external
        nonReentrant
        returns (uint256 certificateTokenId)
    {
        Course memory c = courses[courseId];
        if (c.educator == address(0)) revert CourseNotFound();
        if (!c.active) revert CourseInactive();
        if (hasPurchased[courseId][msg.sender]) revert AlreadyPurchased();
        if (address(certificate) == address(0)) revert CertificateNotSet();

        hasPurchased[courseId][msg.sender] = true;

        // Pull funds first (checks-effects-interactions).
        usdc.safeTransferFrom(msg.sender, address(this), c.price);

        uint256 educatorAmount = (c.price * EDUCATOR_BPS) / BPS_DENOMINATOR;
        uint256 platformAmount = (c.price * PLATFORM_BPS) / BPS_DENOMINATOR;
        uint256 consultantAmount = c.price - educatorAmount - platformAmount; // remainder == 5% (or 0)

        // If no consultant, fold their share into the platform cut.
        address platformReceiver = owner();
        if (c.consultant == address(0)) {
            platformAmount += consultantAmount;
            consultantAmount = 0;
        }

        usdc.safeTransfer(c.educator, educatorAmount);
        if (consultantAmount > 0) {
            usdc.safeTransfer(c.consultant, consultantAmount);
        }
        if (platformAmount > 0) {
            usdc.safeTransfer(platformReceiver, platformAmount);
        }

        certificateTokenId = certificate.mint(msg.sender, courseId, ipfsMetadataURI);

        emit CoursePurchased(
            courseId,
            msg.sender,
            c.price,
            educatorAmount,
            consultantAmount,
            platformAmount,
            certificateTokenId
        );
    }

    // ---------- Views ----------

    function getCourse(uint256 courseId) external view returns (Course memory) {
        return courses[courseId];
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
