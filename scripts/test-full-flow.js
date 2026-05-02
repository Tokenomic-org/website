/**
 * test-full-flow.js — End-to-end simulation of the on-chain Tokenomic flow.
 *
 * Standalone ethers v6 script. Works against any JSON-RPC endpoint —
 * local Anvil/Hardhat node, Base Sepolia, or Base mainnet.
 *
 * Local quickstart (two terminals):
 *
 *   # A) start a local chain
 *   npx hardhat node                  # listens on http://127.0.0.1:8545
 *
 *   # B) run the simulation against it
 *   RPC_URL=http://127.0.0.1:8545 \
 *   PRIVATE_KEYS="0xac0974…f80,0x59c699…690d,0x5de4111…1e3a,0x7c852118…cba5" \
 *     node scripts/test-full-flow.js
 *
 * Base Sepolia (real on-chain run):
 *   RPC_URL=https://sepolia.base.org \
 *   PRIVATE_KEYS="0xYOUR_DEPLOYER,0xYOUR_EDUCATOR,0xYOUR_STUDENT,0xYOUR_CONSULTANT" \
 *   USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
 *     node scripts/test-full-flow.js
 *
 * Defaults:
 *   - PRIVATE_KEYS defaults to the well-known anvil/hardhat-node test keys.
 *   - When USDC_ADDRESS is unset, MockUSDC is deployed and 1000 USDC minted to the student.
 *
 * NOTE: this script targets the *legacy* TokenomicMarket / TokenomicCertificate
 * contracts. The Phase 1 suite (RoleRegistry, CourseAccess1155, CertificateNFT,
 * SubscriptionManager, ReferralRegistry, SplitsManager) is exercised by the
 * Hardhat unit tests in `test/`.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const KEYS = (process.env.PRIVATE_KEYS ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80," +
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d," +
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a," +
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
).split(",").map(s => s.trim()).filter(Boolean);

const ART = name => {
  const base = path.basename(name);
  return path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${base}.json`);
};
const load = name => JSON.parse(fs.readFileSync(ART(name), "utf8"));
const fmt  = bn => ethers.formatUnits(bn, 6);

async function deploy(signer, artifact, args) {
  const F = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const c = await F.deploy(...(args || []));
  await c.waitForDeployment();
  return c;
}

function findEvent(contract, receipt, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === name) return parsed;
    } catch (_) { /* not from this contract */ }
  }
  return null;
}

async function main() {
  if (KEYS.length < 4) throw new Error("Need at least 4 PRIVATE_KEYS (deployer,educator,student,consultant)");
  const provider = new ethers.JsonRpcProvider(RPC);
  const [deployer, educator, student, consultant] = KEYS.map(k => new ethers.Wallet(k, provider));

  const net = await provider.getNetwork();
  console.log(`\n=== Full-flow simulation @ ${RPC} (chainId ${net.chainId}) ===`);
  console.log("deployer  ", deployer.address);
  console.log("educator  ", educator.address);
  console.log("student   ", student.address);
  console.log("consultant", consultant.address);

  // 1) USDC
  let usdc;
  let usdcAddress;
  if (process.env.USDC_ADDRESS) {
    const usdcAbi = [
      "function balanceOf(address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function transfer(address,uint256) returns (bool)"
    ];
    usdc = new ethers.Contract(process.env.USDC_ADDRESS, usdcAbi, provider);
    usdcAddress = process.env.USDC_ADDRESS;
    console.log("\n[1] Using existing USDC:", usdcAddress);
  } else {
    const mockArt = load("mocks/MockUSDC");
    usdc = await deploy(deployer, mockArt);
    usdcAddress = await usdc.getAddress();
    console.log("\n[1] MockUSDC at", usdcAddress);
    await (await usdc.connect(deployer).mint(student.address, ethers.parseUnits("1000", 6))).wait();
  }

  // 2) Deploy Cert + Market
  const certArt   = load("TokenomicCertificate");
  const marketArt = load("TokenomicMarket");
  const cert   = await deploy(deployer, certArt,   [deployer.address]);
  const market = await deploy(deployer, marketArt, [deployer.address, usdcAddress, await cert.getAddress()]);
  await (await cert.connect(deployer).setMarket(await market.getAddress())).wait();
  console.log("[2] Certificate:", await cert.getAddress());
  console.log("    Market:     ", await market.getAddress());

  // 3) Educator registers a course
  const price = ethers.parseUnits("49.99", 6);
  const ipfs  = "ipfs://bafkreiabc123fakecidforlocaltest";
  const tx1   = await market.connect(educator).registerCourse(ipfs, price, consultant.address);
  const r1    = await tx1.wait();
  const reg   = findEvent(market, r1, "CourseRegistered");
  const courseId = reg.args.courseId.toString();
  console.log(`[3] Course #${courseId} registered (49.99 USDC, consultant=${consultant.address.slice(0,6)}…)`);

  // 4) Student approves + purchases
  await (await usdc.connect(student).approve(await market.getAddress(), price)).wait();
  const tx2 = await market.connect(student).purchase(courseId);
  const r2  = await tx2.wait();
  const ev  = findEvent(market, r2, "CoursePurchased");
  console.log(`[4] Student purchased -> certificateTokenId pending=${ev.args.certificateTokenId.toString()}, ` +
              `educatorAmount=${fmt(ev.args.educatorAmount)} USDC, ` +
              `consultantAmount=${fmt(ev.args.consultantAmount)} USDC, ` +
              `platformAmount=${fmt(ev.args.platformAmount)} USDC`);

  // 5) Verify balances
  console.log(`[5] Educator pending:   ${fmt(await market.pendingWithdrawals(educator.address))} USDC`);
  console.log(`    Consultant pending: ${fmt(await market.pendingWithdrawals(consultant.address))} USDC`);
  console.log(`    Platform balance:   ${fmt(await market.platformBalance())} USDC`);

  // 6) Educator + consultant withdraw
  const before = await usdc.balanceOf(educator.address);
  await (await market.connect(educator).withdrawUSDC()).wait();
  const after  = await usdc.balanceOf(educator.address);
  console.log(`[6] Educator withdrew: +${fmt(after - before)} USDC`);
  await (await market.connect(consultant).withdrawUSDC()).wait();
  console.log(`    Consultant USDC bal: ${fmt(await usdc.balanceOf(consultant.address))} USDC`);

  // 7) Owner sweeps platform fees
  const ownerBefore = await usdc.balanceOf(deployer.address);
  await (await market.connect(deployer).withdrawPlatformFees(deployer.address)).wait();
  console.log(`[7] Owner platform sweep: +${fmt((await usdc.balanceOf(deployer.address)) - ownerBefore)} USDC`);

  // 8) Read-side checks (mirrors getEducatorCourses / getEducatorSales)
  const ids   = await market.getCoursesByEducator(educator.address);
  const sales = await market.queryFilter(market.filters.PurchaseSettled(null, null, educator.address));
  console.log(`[8] Educator has ${ids.length} course(s); ${sales.length} sale event(s) on-chain.`);

  console.log("\n✅ End-to-end flow OK\n");
}

main().catch(e => { console.error(e); process.exit(1); });
