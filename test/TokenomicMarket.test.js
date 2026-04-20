const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenomicMarket + TokenomicCertificate", function () {
  let owner, educator, consultant, buyer;
  let usdc, cert, market;
  const PRICE = 100_000_000n; // 100 USDC (6 decimals)

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

  it("splits 90/5/5 with consultant", async function () {
    await market.addCourse(1, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(1, "ipfs://QmTest/cert.json");
    expect(await usdc.balanceOf(educator.address)).to.equal(90_000_000n);
    expect(await usdc.balanceOf(consultant.address)).to.equal(5_000_000n);
    expect(await usdc.balanceOf(owner.address)).to.equal(5_000_000n);
    expect(await cert.balanceOf(buyer.address)).to.equal(1n);
  });

  it("rolls consultant share into platform when consultant is zero address", async function () {
    await market.addCourse(2, educator.address, ethers.ZeroAddress, PRICE);
    await market.connect(buyer).purchase(2, "ipfs://QmTest/cert.json");
    expect(await usdc.balanceOf(educator.address)).to.equal(90_000_000n);
    expect(await usdc.balanceOf(owner.address)).to.equal(10_000_000n);
  });

  it("blocks duplicate purchase by same buyer", async function () {
    await market.addCourse(3, educator.address, consultant.address, PRICE);
    await market.connect(buyer).purchase(3, "ipfs://QmTest/cert.json");
    await expect(
      market.connect(buyer).purchase(3, "ipfs://QmTest/cert.json")
    ).to.be.revertedWithCustomError(market, "AlreadyPurchased");
  });

  it("only market can mint certificates", async function () {
    await expect(
      cert.mint(buyer.address, 1, "ipfs://x")
    ).to.be.revertedWithCustomError(cert, "OnlyMarket");
  });
});
