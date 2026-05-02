/**
 * Deploys the Phase 1 Tokenomic suite to Base / Base Sepolia and writes:
 *   - deployments/<network>.json    — addresses + chain metadata
 *   - packages/abi/<Contract>.json  — ABI + chainId→address map for the
 *                                     frontend, Cloudflare Workers, and any
 *                                     downstream tooling.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network base-sepolia
 *
 *   # Mainnet requires --confirm-mainnet to guard against accidental runs:
 *   CONFIRM_MAINNET=1 npx hardhat run scripts/deploy.js --network base
 *
 * Environment:
 *   PRIVATE_KEY               deployer
 *   PLATFORM_TREASURY         multisig that receives the platform fee (defaults to deployer)
 *   USDC_ADDRESS              override default USDC for the chain
 *   SPLIT_MAIN_ADDRESS        override default 0xSplits SplitMain for the chain
 *   SUBSCRIPTION_PRICE_USDC   monthly subscription in USDC base units (default: 9990000 = 9.99)
 *   ADMIN_ADDRESS             admin/owner of RoleRegistry (defaults to deployer)
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DEFAULT_USDC_BY_CHAIN = {
  8453:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet (Circle USDC)
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"  // Base Sepolia (Circle USDC)
};

// 0xSplits SplitMain ships at the same canonical address on Base + Base Sepolia.
// Source: https://docs.0xsplits.xyz/sdk/splits-sdk#chains
const DEFAULT_SPLIT_MAIN_BY_CHAIN = {
  8453:  "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE",
  84532: "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE"
};

const CONTRACTS = [
  "RoleRegistry",
  "ReferralRegistry",
  "SplitsManager",
  "CourseAccess1155",
  "CertificateNFT",
  "SubscriptionManager"
];

const REPO_ROOT      = path.join(__dirname, "..");
const DEPLOY_DIR     = path.join(REPO_ROOT, "deployments");
const ABI_DIR        = path.join(REPO_ROOT, "packages", "abi");

function networkSlug(name, chainId) {
  if (name && name !== "hardhat" && name !== "localhost") return name;
  return `chain-${chainId}`;
}

function readJsonOrEmpty(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (_) { return {}; }
}

async function deployContract(name, args) {
  const F = await hre.ethers.getContractFactory(name);
  const c = await F.deploy(...args);
  await c.waitForDeployment();
  const address = await c.getAddress();
  console.log(`  ✓ ${name.padEnd(22)} ${address}`);
  return { contract: c, address };
}

function writeAbiPackage(chainId, deployments) {
  fs.mkdirSync(ABI_DIR, { recursive: true });
  for (const name of CONTRACTS) {
    const artifact = hre.artifacts.readArtifactSync(name);
    const file = path.join(ABI_DIR, `${name}.json`);
    const existing = readJsonOrEmpty(file);
    const addresses = existing.addresses || {};
    addresses[String(chainId)] = deployments[name];
    fs.writeFileSync(file, JSON.stringify({
      contractName: name,
      abi: artifact.abi,
      addresses
    }, null, 2));
  }

  // Single-shot index for easy import.
  const indexFile = path.join(ABI_DIR, "index.json");
  const existingIndex = readJsonOrEmpty(indexFile);
  existingIndex.contracts = CONTRACTS;
  existingIndex.deployments = existingIndex.deployments || {};
  existingIndex.deployments[String(chainId)] = deployments;
  fs.writeFileSync(indexFile, JSON.stringify(existingIndex, null, 2));
  console.log(`  ✓ packages/abi/ updated (${CONTRACTS.length} contracts)`);
}

function writeDeployment(slug, record) {
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  const file = path.join(DEPLOY_DIR, `${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`  ✓ deployments/${slug}.json`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  // Mainnet safety latch.
  if (chainId === 8453 && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Refusing to deploy to Base mainnet without CONFIRM_MAINNET=1.");
  }

  const usdc       = process.env.USDC_ADDRESS       || DEFAULT_USDC_BY_CHAIN[chainId];
  const splitMain  = process.env.SPLIT_MAIN_ADDRESS || DEFAULT_SPLIT_MAIN_BY_CHAIN[chainId];
  const treasury   = process.env.PLATFORM_TREASURY  || deployer.address;
  const admin      = process.env.ADMIN_ADDRESS      || deployer.address;
  const subPrice   = BigInt(process.env.SUBSCRIPTION_PRICE_USDC || "9990000"); // 9.99 USDC

  if (!usdc) throw new Error(`No USDC address configured for chainId ${chainId}; set USDC_ADDRESS.`);
  if (!splitMain) throw new Error(`No 0xSplits SplitMain address for chainId ${chainId}; set SPLIT_MAIN_ADDRESS.`);

  console.log("--------------------------------------------------");
  console.log("Network    :", hre.network.name, `(chainId ${chainId})`);
  console.log("Deployer   :", deployer.address);
  console.log("Admin      :", admin);
  console.log("Treasury   :", treasury);
  console.log("USDC       :", usdc);
  console.log("SplitMain  :", splitMain);
  console.log("Sub price  :", subPrice.toString(), "(USDC base units)");
  console.log("--------------------------------------------------\n");

  const out = {};

  console.log("Deploying suite...");
  const { address: roleRegistry } = await deployContract("RoleRegistry", [admin]);
  out.RoleRegistry = roleRegistry;

  const { address: referralRegistry } = await deployContract("ReferralRegistry", []);
  out.ReferralRegistry = referralRegistry;

  const { address: splitsManager } = await deployContract("SplitsManager",
    [roleRegistry, referralRegistry, splitMain, usdc, treasury]);
  out.SplitsManager = splitsManager;

  const { address: courseAccess } = await deployContract("CourseAccess1155",
    [roleRegistry, splitsManager, usdc]);
  out.CourseAccess1155 = courseAccess;

  const { address: certificate } = await deployContract("CertificateNFT", [roleRegistry]);
  out.CertificateNFT = certificate;

  const { address: subscriptionManager } = await deployContract("SubscriptionManager",
    [roleRegistry, usdc, treasury, subPrice]);
  out.SubscriptionManager = subscriptionManager;

  console.log("\nWriting outputs...");
  const slug = networkSlug(hre.network.name, chainId);
  const record = {
    network: hre.network.name,
    chainId,
    deployer: deployer.address,
    admin,
    treasury,
    usdc,
    splitMain,
    subscriptionPriceUSDC: subPrice.toString(),
    addresses: out,
    timestamp: new Date().toISOString()
  };
  writeDeployment(slug, record);
  writeAbiPackage(chainId, out);

  console.log("\nNext steps:");
  console.log(`  Verify on Basescan:`);
  console.log(`    npx hardhat verify --network ${hre.network.name} ${roleRegistry} ${admin}`);
  console.log(`    npx hardhat verify --network ${hre.network.name} ${referralRegistry}`);
  console.log(`    npx hardhat verify --network ${hre.network.name} ${splitsManager} ${roleRegistry} ${referralRegistry} ${splitMain} ${usdc} ${treasury}`);
  console.log(`    npx hardhat verify --network ${hre.network.name} ${courseAccess} ${roleRegistry} ${splitsManager} ${usdc}`);
  console.log(`    npx hardhat verify --network ${hre.network.name} ${certificate} ${roleRegistry}`);
  console.log(`    npx hardhat verify --network ${hre.network.name} ${subscriptionManager} ${roleRegistry} ${usdc} ${treasury} ${subPrice.toString()}`);
  console.log(`\n  Then update wrangler.toml [vars]:`);
  console.log(`    ROLE_REGISTRY        = "${roleRegistry}"`);
  console.log(`    REFERRAL_REGISTRY    = "${referralRegistry}"`);
  console.log(`    SPLITS_MANAGER       = "${splitsManager}"`);
  console.log(`    COURSE_ACCESS_1155   = "${courseAccess}"`);
  console.log(`    CERTIFICATE_NFT      = "${certificate}"`);
  console.log(`    SUBSCRIPTION_MANAGER = "${subscriptionManager}"`);
}

main().catch((err) => { console.error(err); process.exit(1); });
