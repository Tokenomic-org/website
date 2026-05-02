const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = 100n * 1_000_000n; // 100 USDC

describe("CourseAccess1155", function () {
  let admin, treasury, educator, student, referrer, outsider;
  let roles, referrals, splitMain, usdc, mgr, course;

  beforeEach(async function () {
    [admin, treasury, educator, student, referrer, outsider] = await ethers.getSigners();

    const RR = await ethers.getContractFactory("RoleRegistry");
    roles = await RR.deploy(admin.address);
    await roles.waitForDeployment();
    await roles.connect(admin).grantRole(await roles.EDUCATOR_ROLE(), educator.address);

    const Ref = await ethers.getContractFactory("ReferralRegistry");
    referrals = await Ref.deploy();
    await referrals.waitForDeployment();

    const SM = await ethers.getContractFactory("MockSplitMain");
    splitMain = await SM.deploy();
    await splitMain.waitForDeployment();

    const M = await ethers.getContractFactory("MockUSDC");
    usdc = await M.deploy();
    await usdc.waitForDeployment();
    await usdc.mint(student.address, 10n * PRICE);

    const Mgr = await ethers.getContractFactory("SplitsManager");
    mgr = await Mgr.deploy(
      await roles.getAddress(),
      await referrals.getAddress(),
      await splitMain.getAddress(),
      await usdc.getAddress(),
      treasury.address
    );
    await mgr.waitForDeployment();

    const C = await ethers.getContractFactory("CourseAccess1155");
    course = await C.deploy(await roles.getAddress(), await mgr.getAddress(), await usdc.getAddress());
    await course.waitForDeployment();
  });

  it("constructor rejects zero addresses", async function () {
    const C = await ethers.getContractFactory("CourseAccess1155");
    await expect(C.deploy(ethers.ZeroAddress, await mgr.getAddress(), await usdc.getAddress()))
      .to.be.revertedWith("CourseAccess1155: zero addr");
    await expect(C.deploy(await roles.getAddress(), ethers.ZeroAddress, await usdc.getAddress()))
      .to.be.revertedWith("CourseAccess1155: zero addr");
    await expect(C.deploy(await roles.getAddress(), await mgr.getAddress(), ethers.ZeroAddress))
      .to.be.revertedWith("CourseAccess1155: zero addr");
  });

  it("only EDUCATOR_ROLE can createCourse; validates inputs", async function () {
    await expect(course.connect(outsider).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta"))
      .to.be.revertedWithCustomError(course, "NotEducator");

    await expect(course.connect(educator).createCourse(0, 900_000, 50_000, 50_000, "ipfs://meta"))
      .to.be.revertedWithCustomError(course, "InvalidPrice");
    await expect(course.connect(educator).createCourse(PRICE, 900_000, 50_000, 49_999, "ipfs://meta"))
      .to.be.revertedWithCustomError(course, "InvalidBps");
    await expect(course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, ""))
      .to.be.revertedWithCustomError(course, "InvalidURI");

    await expect(course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta"))
      .to.emit(course, "CourseCreated")
      .withArgs(1, educator.address, PRICE, 900_000, 50_000, 50_000, "ipfs://meta");
    expect(await course.uri(1)).to.equal("ipfs://meta");
  });

  it("updateCourse: only educator-owner; validates", async function () {
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta");
    await expect(course.connect(outsider).updateCourse(99, PRICE, true))
      .to.be.revertedWithCustomError(course, "CourseNotFound");
    await expect(course.connect(outsider).updateCourse(1, PRICE, true))
      .to.be.revertedWithCustomError(course, "NotEducator");
    await expect(course.connect(educator).updateCourse(1, 0, true))
      .to.be.revertedWithCustomError(course, "InvalidPrice");
    await expect(course.connect(educator).updateCourse(1, 2n * PRICE, false))
      .to.emit(course, "CourseUpdated").withArgs(1, 2n * PRICE, false);
  });

  it("setActive: platform-only, requires existing course", async function () {
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta");
    await expect(course.connect(outsider).setActive(1, false)).to.be.revertedWithCustomError(course, "NotPlatform");
    await expect(course.connect(admin).setActive(99, false)).to.be.revertedWithCustomError(course, "CourseNotFound");
    await expect(course.connect(admin).setActive(1, false))
      .to.emit(course, "CourseUpdated").withArgs(1, PRICE, false);
  });

  it("purchase happy path: routes USDC through splitter, mints 1 token", async function () {
    await referrals.connect(student).setReferrer(referrer.address);
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta");

    await usdc.connect(student).approve(await course.getAddress(), PRICE);
    await expect(course.connect(student).purchase(1))
      .to.emit(course, "CoursePurchased");

    expect(await course.balanceOf(student.address, 1)).to.equal(1n);
    expect(await course.hasAccess(student.address, 1)).to.equal(true);

    const split = await mgr.getSplitFor(educator.address, student.address, 900_000, 50_000, 50_000);
    // purchase() auto-distributes — funds are credited to recipients in the
    // same tx; the split itself ends up empty.
    expect(await usdc.balanceOf(split)).to.equal(0n);
    const usdcAddr = await usdc.getAddress();
    expect(await splitMain.withdrawable(educator.address, usdcAddr)).to.equal((PRICE * 900_000n) / 1_000_000n);
    expect(await splitMain.withdrawable(referrer.address, usdcAddr)).to.equal((PRICE * 50_000n) / 1_000_000n);
    expect(await splitMain.withdrawable(treasury.address, usdcAddr)).to.equal((PRICE * 50_000n) / 1_000_000n);

    // Recipient pulls into their wallet via SplitMain.
    await splitMain.withdraw(educator.address, 0, [usdcAddr]);
    expect(await usdc.balanceOf(educator.address)).to.equal((PRICE * 900_000n) / 1_000_000n);
  });

  it("purchase reverts on missing / inactive / already-owned / non-existent", async function () {
    await expect(course.connect(student).purchase(99))
      .to.be.revertedWithCustomError(course, "CourseNotFound");

    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta");
    await course.connect(admin).setActive(1, false);
    await usdc.connect(student).approve(await course.getAddress(), PRICE);
    await expect(course.connect(student).purchase(1))
      .to.be.revertedWithCustomError(course, "CourseInactive");

    await course.connect(admin).setActive(1, true);
    await course.connect(student).purchase(1);
    await usdc.connect(student).approve(await course.getAddress(), PRICE);
    await expect(course.connect(student).purchase(1))
      .to.be.revertedWithCustomError(course, "AlreadyOwned");
  });

  it("re-uses the cached split for two courses with the same bps tuple (auto-distributes both)", async function () {
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://a");
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://b");

    await usdc.connect(student).approve(await course.getAddress(), 2n * PRICE);
    await course.connect(student).purchase(1);
    const split1 = await mgr.getSplitFor(educator.address, student.address, 900_000, 50_000, 50_000);
    await course.connect(student).purchase(2);
    const split2 = await mgr.getSplitFor(educator.address, student.address, 900_000, 50_000, 50_000);
    expect(split1).to.equal(split2);
    // Auto-distribute drains the split each time → balance is always 0.
    expect(await usdc.balanceOf(split1)).to.equal(0n);
    expect(await splitMain.withdrawable(educator.address, await usdc.getAddress()))
      .to.equal((2n * PRICE * 900_000n) / 1_000_000n);
  });

  it("uses different splits for two courses with different bps tuples (per-course economics preserved)", async function () {
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://a");   // 90/5/5
    await course.connect(educator).createCourse(PRICE, 800_000, 100_000, 100_000, "ipfs://b"); // 80/10/10

    await usdc.connect(student).approve(await course.getAddress(), 2n * PRICE);
    await course.connect(student).purchase(1);
    await course.connect(student).purchase(2);

    const splitA = await mgr.getSplitFor(educator.address, student.address, 900_000, 50_000, 50_000);
    const splitB = await mgr.getSplitFor(educator.address, student.address, 800_000, 100_000, 100_000);
    expect(splitA).to.not.equal(splitB);
    // Auto-distribute drains both splits in their respective purchase txs.
    expect(await usdc.balanceOf(splitA)).to.equal(0n);
    expect(await usdc.balanceOf(splitB)).to.equal(0n);

    expect(await splitMain.withdrawable(educator.address, await usdc.getAddress()))
      .to.equal((PRICE * 900_000n) / 1_000_000n + (PRICE * 800_000n) / 1_000_000n);
  });

  it("griefer cannot poison a course purchase by pre-creating a split for the buyer/educator pair", async function () {
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta");
    // Outsider front-runs with a wildly different bps tuple.
    await mgr.connect(outsider).createSplitFor(educator.address, student.address, 100_000, 100_000, 800_000);

    await usdc.connect(student).approve(await course.getAddress(), PRICE);
    await course.connect(student).purchase(1);

    const legit = await mgr.getSplitFor(educator.address, student.address, 900_000, 50_000, 50_000);
    expect(legit).to.not.equal(ethers.ZeroAddress);
    expect(await usdc.balanceOf(legit)).to.equal(0n); // auto-distributed
    expect(await splitMain.withdrawable(educator.address, await usdc.getAddress()))
      .to.equal((PRICE * 900_000n) / 1_000_000n);
  });

  it("is soulbound — safeTransferFrom and safeBatchTransferFrom revert", async function () {
    await course.connect(educator).createCourse(PRICE, 900_000, 50_000, 50_000, "ipfs://meta");
    await usdc.connect(student).approve(await course.getAddress(), PRICE);
    await course.connect(student).purchase(1);

    await expect(
      course.connect(student).safeTransferFrom(student.address, outsider.address, 1, 1, "0x")
    ).to.be.revertedWithCustomError(course, "SoulboundTransfer");

    await expect(
      course.connect(student).safeBatchTransferFrom(student.address, outsider.address, [1], [1], "0x")
    ).to.be.revertedWithCustomError(course, "SoulboundTransfer");
  });

  it("supportsInterface returns true for ERC1155", async function () {
    expect(await course.supportsInterface("0xd9b67a26")).to.equal(true);
  });
});
