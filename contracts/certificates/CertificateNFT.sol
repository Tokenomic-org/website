// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

import {RoleRegistry} from "../registries/RoleRegistry.sol";

/// @title CertificateNFT
/// @notice Soulbound ERC-721 issued by educators to attest that a student has
///         completed a course. Anyone holding `EDUCATOR_ROLE` in the bound
///         {RoleRegistry} can mint; once minted, the token is non-transferable
///         (soulbound). Owner of the cert can burn it themselves if they want
///         to delete the on-chain credential.
/// @dev Soulbound enforcement lives in OZ v5's `_update` hook so it covers
///      both `transferFrom` and `safeTransferFrom`. Mint (`auth == 0` and
///      `from == 0`) and burn (`to == 0`) paths remain open.
contract CertificateNFT is ERC721, ERC721URIStorage {
    /// @notice Role registry consulted on every mint.
    RoleRegistry public immutable roles;

    /// @notice Auto-incrementing token id (starts at 1 for nicer URIs).
    uint256 public nextTokenId = 1;

    /// @notice tokenId => courseId (the course this certificate certifies).
    mapping(uint256 => uint256) public courseIdOf;

    /// @notice tokenId => issuing educator (gas-efficient way to surface this
    ///         in dashboards without re-walking events).
    mapping(uint256 => address) public issuerOf;

    event CertificateMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 indexed courseId,
        address issuer,
        string uri
    );

    error NotEducator();
    error InvalidRecipient();
    error InvalidURI();
    error SoulboundTransfer();

    constructor(RoleRegistry _roles) ERC721("Tokenomic Certificate", "TKNCERT") {
        require(address(_roles) != address(0), "CertificateNFT: roles=0");
        roles = _roles;
    }

    /// @notice Mint a certificate. Only EDUCATOR_ROLE may call.
    /// @param to        Student wallet receiving the soulbound NFT.
    /// @param courseId  Course identifier from {CourseAccess1155}.
    /// @param uri_      Full ipfs:// URI for the cert metadata JSON.
    /// @return tokenId  Newly minted token id.
    function mint(address to, uint256 courseId, string calldata uri_)
        external
        returns (uint256 tokenId)
    {
        if (!roles.hasRole(roles.EDUCATOR_ROLE(), msg.sender)) revert NotEducator();
        if (to == address(0)) revert InvalidRecipient();
        if (bytes(uri_).length == 0) revert InvalidURI();

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri_);
        courseIdOf[tokenId] = courseId;
        issuerOf[tokenId] = msg.sender;
        emit CertificateMinted(to, tokenId, courseId, msg.sender, uri_);
    }

    /// @notice Burn a certificate the caller owns. Permanent.
    function burn(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (owner != msg.sender) revert SoulboundTransfer(); // reuse error for "not owner"
        _burn(tokenId);
    }

    // ---------- Soulbound enforcement ----------

    /// @dev Block transfers between non-zero addresses.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert SoulboundTransfer();
        return super._update(to, tokenId, auth);
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
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
