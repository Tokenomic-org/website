const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenomicMarket + TokenomicCertificate", function () {
  let owner, educator, consultant, buyer;
  let usdc, cert, market;
  const PRICE = 100_000_000n; // 100 USDC (6 decimals)
  const CERT_URI = "ipfs://QmTest/cert.json";

  beforeEach(async function () {
    [owner, educator, consultant, buyer] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockUSDC");
    usdc = await Mock.deploy();
    await usdc.waitForDeployment();

    const Cert = await ethers.getContractFactory("TokenomicCertificate");
    cert = await Cert.deploy(owner.address);
    await cert.waitForDeployment();

    const Market = await ethers.getContractFactory("TokenomicMarket");
    market = await Market.deploy(owner.address, await usdc.getAddress(), await cert.getAddress());
    await market.waitForDeployment();

    await cert.setMarket(await market.getAddress());

    // Fund buyer
    await usdc.mint(buyer.address, 1_000_000_000n);
    await usdc.connect(buyer).approve(await market.getAddress(), ethers.MaxUint256);
  });

  it("splits 90/5/5 with consultant and does NOT mint cert at purchase time", async function () {
    await market.addCourse(1, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(1);
    // Pull-payment model: nothing is transferred at purchase, only credited.
    expect(await usdc.balanceOf(educator.address)).to.equal(0n);
    expect(await usdc.balanceOf(consultant.address)).to.equal(0n);
    expect(await usdc.balanceOf(owner.address)).to.equal(0n);
    // Certificate is NOT minted by purchase — buyer claims separately.
    expect(await cert.balanceOf(buyer.address)).to.equal(0n);
    expect(await market.certificateOf(1, buyer.address)).to.equal(0n);
    // Educator earnings credited for withdraw.
    expect(await market.pendingWithdrawals(educator.address)).to.equal(90_000_000n);
    expect(await market.pendingWithdrawals(consultant.address)).to.equal(5_000_000n);
    expect(await market.platformBalance()).to.equal(5_000_000n);
  });

  it("rolls consultant share into platform when consultant is zero address", async function () {
    await market.addCourse(2, educator.address, ethers.ZeroAddress, PRICE);
    await market.connect(buyer).purchase(2);
    expect(await market.pendingWithdrawals(educator.address)).to.equal(90_000_000n);
    expect(await market.platformBalance()).to.equal(10_000_000n);
  });

  it("blocks duplicate purchase by same buyer", async function () {
    await market.addCourse(3, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(3);
    await expect(
      market.connect(buyer).purchase(3)
    ).to.be.revertedWithCustomError(market, "AlreadyPurchased");
  });

  it("only market can mint certificates directly", async function () {
    await expect(
      cert.mint(buyer.address, 1, "ipfs://x")
    ).to.be.revertedWithCustomError(cert, "OnlyMarket");
  });

  it("buyer claims certificate after purchase (buyer pays the gas)", async function () {
    await market.addCourse(4, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(4);

    const tx = await market.connect(buyer).claimCertificate(4, CERT_URI);
    await tx.wait();

    expect(await cert.balanceOf(buyer.address)).to.equal(1n);
    const tokenId = await market.certificateOf(4, buyer.address);
    expect(tokenId).to.be.gt(0n);
    expect(await cert.tokenURI(tokenId)).to.equal(CERT_URI);
    expect(await cert.ownerOf(tokenId)).to.equal(buyer.address);
  });

  it("rejects claim before purchase", async function () {
    await market.addCourse(5, educator.address, consultant.address, PRICE);
    await expect(
      market.connect(buyer).claimCertificate(5, CERT_URI)
    ).to.be.revertedWithCustomError(market, "NotPurchased");
  });

  it("rejects double-claim of certificate", async function () {
    await market.addCourse(6, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(6);
    await market.connect(buyer).claimCertificate(6, CERT_URI);
    await expect(
      market.connect(buyer).claimCertificate(6, CERT_URI)
    ).to.be.revertedWithCustomError(market, "AlreadyClaimed");
  });

  it("rejects claim with empty metadata URI", async function () {
    await market.addCourse(7, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(7);
    await expect(
      market.connect(buyer).claimCertificate(7, "")
    ).to.be.revertedWithCustomError(market, "InvalidAddress");
  });

  it("educator can sponsor a batch mint for buyers (educator pays gas)", async function () {
    await market.addCourse(8, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(8);
    await market.connect(educator).mintCertificatesForBuyers(
      8, [buyer.address], [CERT_URI]
    );
    expect(await cert.balanceOf(buyer.address)).to.equal(1n);
    // A subsequent self-claim is blocked because the slot is already filled.
    await expect(
      market.connect(buyer).claimCertificate(8, CERT_URI)
    ).to.be.revertedWithCustomError(market, "AlreadyClaimed");
  });

  it("non-educator cannot call sponsored batch mint", async function () {
    await market.addCourse(9, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(9);
    await expect(
      market.connect(buyer).mintCertificatesForBuyers(9, [buyer.address], [CERT_URI])
    ).to.be.revertedWithCustomError(market, "InvalidAddress");
  });

  it("educator and consultant withdraw their own USDC (each pays own gas)", async function () {
    await market.addCourse(10, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(10);

    await market.connect(educator).withdrawUSDC();
    await market.connect(consultant).withdrawUSDC();

    expect(await usdc.balanceOf(educator.address)).to.equal(90_000_000n);
    expect(await usdc.balanceOf(consultant.address)).to.equal(5_000_000n);
    expect(await market.pendingWithdrawals(educator.address)).to.equal(0n);
    expect(await market.pendingWithdrawals(consultant.address)).to.equal(0n);
  });
});
