const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CertificateNFT", function () {
  let admin, educator, student, other;
  let roles, cert;

  beforeEach(async function () {
    [admin, educator, student, other] = await ethers.getSigners();
    const RR = await ethers.getContractFactory("RoleRegistry");
    roles = await RR.deploy(admin.address);
    await roles.waitForDeployment();
    await roles.connect(admin).grantRole(await roles.EDUCATOR_ROLE(), educator.address);

    const C = await ethers.getContractFactory("CertificateNFT");
    cert = await C.deploy(await roles.getAddress());
    await cert.waitForDeployment();
  });

  it("constructor rejects zero RoleRegistry", async function () {
    const C = await ethers.getContractFactory("CertificateNFT");
    await expect(C.deploy(ethers.ZeroAddress)).to.be.revertedWith("CertificateNFT: roles=0");
  });

  it("only EDUCATOR_ROLE can mint", async function () {
    await expect(cert.connect(other).mint(student.address, 1, "ipfs://x"))
      .to.be.revertedWithCustomError(cert, "NotEducator");

    await expect(cert.connect(educator).mint(ethers.ZeroAddress, 1, "ipfs://x"))
      .to.be.revertedWithCustomError(cert, "InvalidRecipient");

    await expect(cert.connect(educator).mint(student.address, 1, ""))
      .to.be.revertedWithCustomError(cert, "InvalidURI");

    await expect(cert.connect(educator).mint(student.address, 42, "ipfs://meta.json"))
      .to.emit(cert, "CertificateMinted")
      .withArgs(student.address, 1, 42, educator.address, "ipfs://meta.json");

    expect(await cert.ownerOf(1)).to.equal(student.address);
    expect(await cert.tokenURI(1)).to.equal("ipfs://meta.json");
    expect(await cert.courseIdOf(1)).to.equal(42n);
    expect(await cert.issuerOf(1)).to.equal(educator.address);
  });

  it("is soulbound — transfer / safeTransferFrom revert", async function () {
    await cert.connect(educator).mint(student.address, 1, "ipfs://meta.json");

    await expect(cert.connect(student).transferFrom(student.address, other.address, 1))
      .to.be.revertedWithCustomError(cert, "SoulboundTransfer");

    await expect(
      cert.connect(student)["safeTransferFrom(address,address,uint256)"](student.address, other.address, 1)
    ).to.be.revertedWithCustomError(cert, "SoulboundTransfer");
  });

  it("owner can burn their cert; non-owner cannot", async function () {
    await cert.connect(educator).mint(student.address, 1, "ipfs://meta.json");
    await expect(cert.connect(other).burn(1))
      .to.be.revertedWithCustomError(cert, "SoulboundTransfer");
    await cert.connect(student).burn(1);
    await expect(cert.ownerOf(1)).to.be.revertedWithCustomError(cert, "ERC721NonexistentToken");
  });

  it("supportsInterface includes ERC721 and ERC721Metadata", async function () {
    expect(await cert.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
    expect(await cert.supportsInterface("0x5b5e139f")).to.equal(true); // ERC721Metadata
  });
});
