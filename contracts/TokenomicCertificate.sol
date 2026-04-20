// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TokenomicCertificate
/// @notice Soulbound-friendly ERC-721 with per-token IPFS metadata and ERC-2981 royalties.
/// @dev Only the configured market contract may mint. Owner may rotate the market and
///      manage default + per-token royalty info to support secondary-sale revenue for educators.
contract TokenomicCertificate is ERC721, ERC721URIStorage, ERC2981, Ownable {
    /// @notice Market contract authorised to mint new certificates.
    address public market;

    /// @notice Auto-incrementing token id (starts at 1 for nicer URIs).
    uint256 public nextTokenId = 1;

    /// @notice Map a tokenId to the courseId it certifies.
    mapping(uint256 => uint256) public tokenIdToCourseId;

    event MarketUpdated(address indexed previousMarket, address indexed newMarket);
    event CertificateMinted(address indexed to, uint256 indexed tokenId, uint256 indexed courseId, string uri);
    event DefaultRoyaltyUpdated(address receiver, uint96 feeNumerator);
    event TokenRoyaltyUpdated(uint256 indexed tokenId, address receiver, uint96 feeNumerator);

    error OnlyMarket();
    error InvalidAddress();

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    constructor(address initialOwner)
        ERC721("Tokenomic Certificate", "TKNCERT")
        Ownable(initialOwner)
    {
        // Default royalty: 0% — owner can opt-in later.
    }

    /// @notice Bind the market contract that is allowed to mint. Owner-only.
    function setMarket(address _market) external onlyOwner {
        if (_market == address(0)) revert InvalidAddress();
        emit MarketUpdated(market, _market);
        market = _market;
    }

    /// @notice Mint a new certificate. Only callable by the market.
    /// @param to         Student wallet receiving the NFT.
    /// @param courseId   Course identifier from TokenomicMarket.
    /// @param ipfsURI    Full ipfs:// URI pointing to JSON metadata.
    function mint(address to, uint256 courseId, string calldata ipfsURI)
        external
        onlyMarket
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert InvalidAddress();
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, ipfsURI);
        tokenIdToCourseId[tokenId] = courseId;
        emit CertificateMinted(to, tokenId, courseId, ipfsURI);
    }

    // ---------- Royalty management (ERC-2981) ----------

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
        emit DefaultRoyaltyUpdated(receiver, feeNumerator);
    }

    function deleteDefaultRoyalty() external onlyOwner {
        _deleteDefaultRoyalty();
        emit DefaultRoyaltyUpdated(address(0), 0);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
        emit TokenRoyaltyUpdated(tokenId, receiver, feeNumerator);
    }

    // ---------- Required overrides ----------

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
