const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoleRegistry", function () {
  let admin, alice, bob, carol;
  let roles;

  beforeEach(async function () {
    [admin, alice, bob, carol] = await ethers.getSigners();
    const RR = await ethers.getContractFactory("RoleRegistry");
    roles = await RR.deploy(admin.address);
    await roles.waitForDeployment();
  });

  it("rejects zero admin in constructor", async function () {
    const RR = await ethers.getContractFactory("RoleRegistry");
    await expect(RR.deploy(ethers.ZeroAddress)).to.be.revertedWith("RoleRegistry: admin=0");
  });

  it("grants admin, platform, treasury roles to constructor admin and emits", async function () {
    const RR = await ethers.getContractFactory("RoleRegistry");
    const tx = await RR.deploy(alice.address);
    await tx.waitForDeployment();
    await expect(tx.deploymentTransaction()).to.emit(tx, "RoleRegistryDeployed").withArgs(alice.address);
    expect(await tx.hasRole(await tx.DEFAULT_ADMIN_ROLE(), alice.address)).to.equal(true);
    expect(await tx.hasRole(await tx.PLATFORM_ROLE(), alice.address)).to.equal(true);
    expect(await tx.hasRole(await tx.TREASURY_ROLE(), alice.address)).to.equal(true);
  });

  it("isEducator reflects EDUCATOR_ROLE", async function () {
    expect(await roles.isEducator(alice.address)).to.equal(false);
    await roles.connect(admin).grantRole(await roles.EDUCATOR_ROLE(), alice.address);
    expect(await roles.isEducator(alice.address)).to.equal(true);
  });

  it("admin can batch grant educators; non-admin cannot", async function () {
    await roles.connect(admin).grantEducators([alice.address, bob.address]);
    expect(await roles.isEducator(alice.address)).to.equal(true);
    expect(await roles.isEducator(bob.address)).to.equal(true);
    expect(await roles.isEducator(carol.address)).to.equal(false);

    await expect(roles.connect(alice).grantEducators([carol.address]))
      .to.be.revertedWithCustomError(roles, "AccessControlUnauthorizedAccount");
  });

  it("supportsInterface returns true for AccessControl interface id", async function () {
    // ERC165 interface id for IAccessControl is 0x7965db0b
    expect(await roles.supportsInterface("0x7965db0b")).to.equal(true);
  });
});
