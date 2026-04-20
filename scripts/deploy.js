/**
 * Deploys TokenomicCertificate then TokenomicMarket, wires them together,
 * and writes ABIs + addresses to artifacts/abis/.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network base-sepolia
 *   npx hardhat run scripts/deploy.js --network base
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DEFAULT_USDC_BY_CHAIN = {
  8453:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet USDC
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"  // Base Sepolia USDC (Circle)
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  const usdcAddress = process.env.USDC_ADDRESS || DEFAULT_USDC_BY_CHAIN[chainId];
  if (!usdcAddress) throw new Error(`No USDC address configured for chainId ${chainId}. Set USDC_ADDRESS env.`);

  console.log("--------------------------------------------------");
  console.log("Network    :", hre.network.name, `(chainId ${chainId})`);
  console.log("Deployer   :", deployer.address);
  console.log("USDC token :", usdcAddress);
  console.log("--------------------------------------------------\n");

  // 1. Certificate
  const Cert = await hre.ethers.getContractFactory("TokenomicCertificate");
  const cert = await Cert.deploy(deployer.address);
  await cert.waitForDeployment();
  const certAddress = await cert.getAddress();
  console.log("TokenomicCertificate deployed:", certAddress);

  // 2. Market
  const Market = await hre.ethers.getContractFactory("TokenomicMarket");
  const market = await Market.deploy(deployer.address, usdcAddress, certAddress);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log("TokenomicMarket      deployed:", marketAddress);

  // 3. Wire certificate -> market
  console.log("\nLinking Certificate.market = Market ...");
  const tx = await cert.setMarket(marketAddress);
  await tx.wait();
  console.log("  done. tx:", tx.hash);

  // 4. Persist ABIs + addresses
  const abiDir = path.join(__dirname, "..", "artifacts", "abis");
  fs.mkdirSync(abiDir, { recursive: true });

  const certArtifact = await hre.artifacts.readArtifact("TokenomicCertificate");
  const marketArtifact = await hre.artifacts.readArtifact("TokenomicMarket");

  fs.writeFileSync(path.join(abiDir, "TokenomicCertificate.json"),
    JSON.stringify({ abi: certArtifact.abi, address: certAddress, chainId }, null, 2));
  fs.writeFileSync(path.join(abiDir, "TokenomicMarket.json"),
    JSON.stringify({ abi: marketArtifact.abi, address: marketAddress, chainId }, null, 2));

  const deploymentRecord = {
    network: hre.network.name,
    chainId,
    deployer: deployer.address,
    usdc: usdcAddress,
    certificate: certAddress,
    market: marketAddress,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(path.join(abiDir, `deployment-${chainId}.json`),
    JSON.stringify(deploymentRecord, null, 2));

  console.log("\nABIs + addresses written to artifacts/abis/");
  console.log("\nNext: verify on Basescan:");
  console.log(`  npx hardhat verify --network ${hre.network.name} ${certAddress} ${deployer.address}`);
  console.log(`  npx hardhat verify --network ${hre.network.name} ${marketAddress} ${deployer.address} ${usdcAddress} ${certAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
