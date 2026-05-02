const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const PRICE = 1_000_000n; // 1 USDC

describe("SubscriptionManager", function () {
  let admin, treasury, alice, bob, outsider;
  let roles, usdc, sub;

  beforeEach(async function () {
    [admin, treasury, alice, bob, outsider] = await ethers.getSigners();

    const RR = await ethers.getContractFactory("RoleRegistry");
    roles = await RR.deploy(admin.address);
    await roles.waitForDeployment();

    const M = await ethers.getContractFactory("MockUSDC");
    usdc = await M.deploy();
    await usdc.waitForDeployment();
    await usdc.mint(alice.address, 100n * PRICE);
    await usdc.mint(bob.address, 100n * PRICE);

    const S = await ethers.getContractFactory("SubscriptionManager");
    sub = await S.deploy(await roles.getAddress(), await usdc.getAddress(), treasury.address, PRICE);
    await sub.waitForDeployment();
  });

  it("constructor input validation", async function () {
    const S = await ethers.getContractFactory("SubscriptionManager");
    await expect(S.deploy(ethers.ZeroAddress, await usdc.getAddress(), treasury.address, PRICE))
      .to.be.revertedWithCustomError(sub, "InvalidAddress");
    await expect(S.deploy(await roles.getAddress(), ethers.ZeroAddress, treasury.address, PRICE))
      .to.be.revertedWithCustomError(sub, "InvalidAddress");
    await expect(S.deploy(await roles.getAddress(), await usdc.getAddress(), ethers.ZeroAddress, PRICE))
      .to.be.revertedWithCustomError(sub, "InvalidAddress");
    await expect(S.deploy(await roles.getAddress(), await usdc.getAddress(), treasury.address, 0))
      .to.be.revertedWithCustomError(sub, "InvalidPrice");
  });

  it("subscribes once, extends expiry, transfers USDC to treasury", async function () {
    await usdc.connect(alice).approve(await sub.getAddress(), PRICE);
    const tx = await sub.connect(alice).subscribe();
    const rcpt = await tx.wait();
    const block = await ethers.provider.getBlock(rcpt.blockNumber);

    expect(await usdc.balanceOf(treasury.address)).to.equal(PRICE);
    const expectedExpiry = BigInt(block.timestamp) + (await sub.MONTH());
    expect(await sub.expiresAt(alice.address)).to.equal(expectedExpiry);
    expect(await sub.isActive(alice.address)).to.equal(true);
    expect(await sub.remaining(alice.address)).to.be.greaterThan(0n);
  });

  it("renewing mid-cycle stacks an extra month onto current expiry", async function () {
    await usdc.connect(alice).approve(await sub.getAddress(), 2n * PRICE);
    await sub.connect(alice).subscribe();
    const expiry1 = await sub.expiresAt(alice.address);

    await sub.connect(alice).subscribe();
    const expiry2 = await sub.expiresAt(alice.address);
    expect(expiry2 - expiry1).to.equal(await sub.MONTH());
  });

  it("renewing after expiry resets base to block.timestamp", async function () {
    await usdc.connect(alice).approve(await sub.getAddress(), 2n * PRICE);
    await sub.connect(alice).subscribe();
    const month = await sub.MONTH();
    await time.increase(Number(month) + 10);
    expect(await sub.isActive(alice.address)).to.equal(false);
    expect(await sub.remaining(alice.address)).to.equal(0n);

    const tx = await sub.connect(alice).subscribe();
    const block = await ethers.provider.getBlock(tx.blockNumber);
    expect(await sub.expiresAt(alice.address)).to.equal(BigInt(block.timestamp) + month);
  });

  it("subscribeMultiple charges N months and rejects 0", async function () {
    await usdc.connect(bob).approve(await sub.getAddress(), 3n * PRICE);
    await expect(sub.connect(bob).subscribeMultiple(0)).to.be.revertedWith("SubscriptionManager: months=0");
    const tx = await sub.connect(bob).subscribeMultiple(3);
    const block = await ethers.provider.getBlock(tx.blockNumber);
    expect(await usdc.balanceOf(treasury.address)).to.equal(3n * PRICE);
    expect(await sub.expiresAt(bob.address)).to.equal(BigInt(block.timestamp) + 3n * (await sub.MONTH()));
  });

  it("only PLATFORM_ROLE can change treasury and price", async function () {
    await expect(sub.connect(outsider).setTreasury(bob.address))
      .to.be.revertedWithCustomError(sub, "NotPlatform");
    await expect(sub.connect(outsider).setMonthlyPrice(2n * PRICE))
      .to.be.revertedWithCustomError(sub, "NotPlatform");

    await expect(sub.connect(admin).setTreasury(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(sub, "InvalidAddress");
    await expect(sub.connect(admin).setMonthlyPrice(0))
      .to.be.revertedWithCustomError(sub, "InvalidPrice");

    await expect(sub.connect(admin).setTreasury(bob.address))
      .to.emit(sub, "TreasuryUpdated").withArgs(treasury.address, bob.address);
    await expect(sub.connect(admin).setMonthlyPrice(2n * PRICE))
      .to.emit(sub, "PriceUpdated").withArgs(PRICE, 2n * PRICE);
  });
});
