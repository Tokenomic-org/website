const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReferralRegistry", function () {
  let alice, bob, carol;
  let registry;

  beforeEach(async function () {
    [alice, bob, carol] = await ethers.getSigners();
    const RR = await ethers.getContractFactory("ReferralRegistry");
    registry = await RR.deploy();
    await registry.waitForDeployment();
  });

  it("starts with no referrer", async function () {
    expect(await registry.referrerOf(alice.address)).to.equal(ethers.ZeroAddress);
    expect(await registry.hasReferrer(alice.address)).to.equal(false);
  });

  it("rejects zero address as referrer", async function () {
    await expect(registry.connect(alice).setReferrer(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, "InvalidReferrer");
  });

  it("rejects self-referral", async function () {
    await expect(registry.connect(alice).setReferrer(alice.address))
      .to.be.revertedWithCustomError(registry, "InvalidReferrer");
  });

  it("sets a referrer once and emits", async function () {
    await expect(registry.connect(alice).setReferrer(bob.address))
      .to.emit(registry, "ReferrerSet").withArgs(alice.address, bob.address);
    expect(await registry.referrerOf(alice.address)).to.equal(bob.address);
    expect(await registry.hasReferrer(alice.address)).to.equal(true);
  });

  it("blocks a second setReferrer call", async function () {
    await registry.connect(alice).setReferrer(bob.address);
    await expect(registry.connect(alice).setReferrer(carol.address))
      .to.be.revertedWithCustomError(registry, "ReferrerAlreadySet");
  });
});
