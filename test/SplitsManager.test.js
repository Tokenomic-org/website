const { expect } = require("chai");
const { ethers } = require("hardhat");

const TOTAL = 1_000_000n;

describe("SplitsManager", function () {
  let admin, treasury, educator, buyer, referrer, outsider;
  let roles, referrals, splitMain, usdc, mgr;

  beforeEach(async function () {
    [admin, treasury, educator, buyer, referrer, outsider] = await ethers.getSigners();

    const RR = await ethers.getContractFactory("RoleRegistry");
    roles = await RR.deploy(admin.address);
    await roles.waitForDeployment();

    const Ref = await ethers.getContractFactory("ReferralRegistry");
    referrals = await Ref.deploy();
    await referrals.waitForDeployment();

    const SM = await ethers.getContractFactory("MockSplitMain");
    splitMain = await SM.deploy();
    await splitMain.waitForDeployment();

    const M = await ethers.getContractFactory("MockUSDC");
    usdc = await M.deploy();
    await usdc.waitForDeployment();

    const Mgr = await ethers.getContractFactory("SplitsManager");
    mgr = await Mgr.deploy(
      await roles.getAddress(),
      await referrals.getAddress(),
      await splitMain.getAddress(),
      await usdc.getAddress(),
      treasury.address
    );
    await mgr.waitForDeployment();
  });

  it("constructor rejects zero addresses", async function () {
    const Mgr = await ethers.getContractFactory("SplitsManager");
    const A = await roles.getAddress();
    const B = await referrals.getAddress();
    const C = await splitMain.getAddress();
    const D = await usdc.getAddress();
    await expect(Mgr.deploy(ethers.ZeroAddress, B, C, D, treasury.address)).to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(Mgr.deploy(A, ethers.ZeroAddress, C, D, treasury.address)).to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(Mgr.deploy(A, B, ethers.ZeroAddress, D, treasury.address)).to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(Mgr.deploy(A, B, C, ethers.ZeroAddress, treasury.address)).to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(Mgr.deploy(A, B, C, D, ethers.ZeroAddress)).to.be.revertedWithCustomError(mgr, "InvalidAddress");
  });

  it("setTreasury is platform-only and validates input", async function () {
    await expect(mgr.connect(outsider).setTreasury(buyer.address)).to.be.revertedWithCustomError(mgr, "NotPlatform");
    await expect(mgr.connect(admin).setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(mgr.connect(admin).setTreasury(buyer.address))
      .to.emit(mgr, "TreasuryUpdated").withArgs(treasury.address, buyer.address);
    expect(await mgr.treasury()).to.equal(buyer.address);
  });

  it("createSplitFor rejects zero addresses and bad bps", async function () {
    await expect(mgr.createSplitFor(ethers.ZeroAddress, buyer.address, 900_000, 50_000, 50_000))
      .to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(mgr.createSplitFor(educator.address, ethers.ZeroAddress, 900_000, 50_000, 50_000))
      .to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 49_999))
      .to.be.revertedWithCustomError(mgr, "InvalidBps");
  });

  it("uses referrer when set; folds to treasury otherwise", async function () {
    // No referrer set: refBps must fold into platform.
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const splitNoRef = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    expect(splitNoRef).to.not.equal(ethers.ZeroAddress);
    let [accounts, allocs] = await mgr.getSplitRecipients(splitNoRef);
    expect(accounts.length).to.equal(2); // educator + treasury
    const totalNoRef = allocs.reduce((s, a) => s + Number(a), 0);
    expect(totalNoRef).to.equal(Number(TOTAL));
  });

  it("buyer-set referrer is honored in subsequent splits", async function () {
    await referrals.connect(buyer).setReferrer(referrer.address);
    const tx = await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const split = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const [accounts, allocs] = await mgr.getSplitRecipients(split);
    expect(accounts.length).to.equal(3);
    // sorted ascending
    for (let i = 1; i < accounts.length; i++) {
      expect(BigInt(accounts[i])).to.be.greaterThan(BigInt(accounts[i - 1]));
    }
    expect(allocs.reduce((s, a) => s + Number(a), 0)).to.equal(Number(TOTAL));
    await expect(tx).to.emit(mgr, "SplitCreated");
  });

  it("returns cached split on repeat call with the same bps tuple", async function () {
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const split1 = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const split2 = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    expect(split1).to.equal(split2);
  });

  it("isolates cache entries per bps tuple (different splits → different addresses)", async function () {
    await referrals.connect(buyer).setReferrer(referrer.address);
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    await mgr.createSplitFor(educator.address, buyer.address, 800_000, 100_000, 100_000);

    const splitA = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const splitB = await mgr.getSplitFor(educator.address, buyer.address, 800_000, 100_000, 100_000);
    expect(splitA).to.not.equal(ethers.ZeroAddress);
    expect(splitB).to.not.equal(ethers.ZeroAddress);
    expect(splitA).to.not.equal(splitB);

    const [, allocsA] = await mgr.getSplitRecipients(splitA);
    const [, allocsB] = await mgr.getSplitRecipients(splitB);
    expect(allocsA.map(Number).sort((x, y) => x - y)).to.deep.equal([50_000, 50_000, 900_000]);
    expect(allocsB.map(Number).sort((x, y) => x - y)).to.deep.equal([100_000, 100_000, 800_000]);
  });

  it("griefer pre-creating with bogus bps does NOT poison the legitimate cache entry", async function () {
    // Outsider front-runs the buyer with a wildly different split.
    await referrals.connect(buyer).setReferrer(referrer.address);
    await mgr.connect(outsider).createSplitFor(educator.address, buyer.address, 100_000, 100_000, 800_000);
    const griefSplit = await mgr.getSplitFor(educator.address, buyer.address, 100_000, 100_000, 800_000);
    expect(griefSplit).to.not.equal(ethers.ZeroAddress);

    // Legitimate (course-configured) bps tuple still resolves to a fresh, correct split.
    const legitBefore = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    expect(legitBefore).to.equal(ethers.ZeroAddress);
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const legit = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    expect(legit).to.not.equal(griefSplit);

    const [, allocs] = await mgr.getSplitRecipients(legit);
    expect(allocs.map(Number).sort((x, y) => x - y)).to.deep.equal([50_000, 50_000, 900_000]);
  });

  it("collapses duplicate recipients (educator == treasury)", async function () {
    // Re-deploy manager with treasury == educator to force the merge branch.
    const Mgr = await ethers.getContractFactory("SplitsManager");
    const m2 = await Mgr.deploy(
      await roles.getAddress(),
      await referrals.getAddress(),
      await splitMain.getAddress(),
      await usdc.getAddress(),
      educator.address // treasury == educator
    );
    await m2.waitForDeployment();
    await m2.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const split = await m2.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const [accounts, allocs] = await m2.getSplitRecipients(split);
    expect(accounts.length).to.equal(1);
    expect(accounts[0]).to.equal(educator.address);
    expect(allocs[0]).to.equal(Number(TOTAL));
  });

  it("ignores referrer when referrer == educator", async function () {
    // buyer's referrer happens to be the educator — should fold into treasury share.
    await referrals.connect(buyer).setReferrer(educator.address);
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const split = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const [accounts, allocs] = await mgr.getSplitRecipients(split);
    expect(accounts.length).to.equal(2);
    const totalEdu = accounts.findIndex(a => a === educator.address);
    expect(totalEdu).to.be.gte(0);
    expect(Number(allocs[totalEdu])).to.equal(900_000);
  });

  it("fundSplit rejects unknown / zero splits and forwards USDC", async function () {
    await expect(mgr.fundSplit(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(mgr, "InvalidAddress");
    await expect(mgr.fundSplit(treasury.address, 1)).to.be.revertedWithCustomError(mgr, "UnknownSplit");

    await referrals.connect(buyer).setReferrer(referrer.address);
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const split = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);

    const amount = 1_000_000n;
    await usdc.mint(outsider.address, amount);
    await usdc.connect(outsider).approve(await mgr.getAddress(), amount);
    await expect(mgr.connect(outsider).fundSplit(split, amount))
      .to.emit(mgr, "SplitFunded").withArgs(split, amount);
    expect(await usdc.balanceOf(split)).to.equal(amount);
  });

  it("distribute fans funds out via SplitMain to all recipients", async function () {
    await expect(mgr.distribute(treasury.address)).to.be.revertedWithCustomError(mgr, "UnknownSplit");

    await referrals.connect(buyer).setReferrer(referrer.address);
    await mgr.createSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);
    const split = await mgr.getSplitFor(educator.address, buyer.address, 900_000, 50_000, 50_000);

    const amount = 1_000_000n;
    await usdc.mint(outsider.address, amount);
    await usdc.connect(outsider).approve(await mgr.getAddress(), amount);
    await mgr.connect(outsider).fundSplit(split, amount);

    await expect(mgr.distribute(split)).to.emit(mgr, "SplitDistributed").withArgs(split, amount);

    expect(await splitMain.withdrawable(educator.address, await usdc.getAddress())).to.equal(900_000n);
    expect(await splitMain.withdrawable(referrer.address, await usdc.getAddress())).to.equal(50_000n);
    expect(await splitMain.withdrawable(treasury.address, await usdc.getAddress())).to.equal(50_000n);

    // Withdrawals via mock SplitMain.
    await splitMain.withdraw(educator.address, 0, [await usdc.getAddress()]);
    expect(await usdc.balanceOf(educator.address)).to.equal(900_000n);
  });

  it("exposes immutable handles", async function () {
    expect(await mgr.TOTAL_BPS()).to.equal(1_000_000);
    expect(await mgr.roles()).to.equal(await roles.getAddress());
    expect(await mgr.referrals()).to.equal(await referrals.getAddress());
    expect(await mgr.splitMain()).to.equal(await splitMain.getAddress());
    expect(await mgr.usdc()).to.equal(await usdc.getAddress());
  });
});
