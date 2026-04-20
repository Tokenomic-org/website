# Tokenomic Smart Contracts — Deployment Guide

Two Solidity ^0.8.24 contracts built with Hardhat + OpenZeppelin v5, targeting **Base L2**.

| Contract | Purpose |
| --- | --- |
| `TokenomicCertificate` | ERC-721 + ERC-2981 royalty NFT minted on every successful course purchase. Only the market may mint. |
| `TokenomicMarket` | USDC-denominated course store. On `purchase()` it pulls USDC, splits **90% educator / 5% consultant / 5% platform** (consultant share folds into platform when no consultant is set), and atomically mints the certificate. |

`Ownable` + `ReentrancyGuard` from OpenZeppelin v5; `SafeERC20` for transfer safety; CEI ordering on the purchase path; per-buyer/course duplicate-purchase guard.

---

## 1. Prerequisites

| You need | How |
| --- | --- |
| Node 20+ | already installed |
| A funded EOA on **Base Sepolia** (testnet) | bridge a tiny amount of Sepolia ETH via [Base bridge](https://bridge.base.org/) |
| A funded EOA on **Base mainnet** | bridge ETH via the same bridge |
| Test USDC on Base Sepolia | <https://faucet.circle.com/> (Base Sepolia) |
| Basescan API key | <https://basescan.org/myapikey> (one key works for sepolia + mainnet) |
| Optional: your own RPC | Cloudflare Ethereum/Base gateway from Prompt 3, Alchemy, QuickNode, etc. |

> ⚠️ **Use a brand-new wallet** for deployments and only put in enough ETH for gas. Never reuse a personal key.

---

## 2. Install + configure

```bash
# Install Hardhat tooling (needs --legacy-peer-deps because the project pins ethers v5 for server.js)
npm install --legacy-peer-deps

# Copy the env template and fill it in
cp .env.example .env
# Then edit .env:
#   PRIVATE_KEY=0x...        deployer key (no 0x is fine too)
#   BASE_RPC_URL=...         Base mainnet RPC
#   BASE_SEPOLIA_RPC_URL=... Base Sepolia RPC
#   BASESCAN_API_KEY=...     for source verification
```

> The repo deliberately keeps **ethers v5** (server.js depends on `ethers.utils.verifyMessage`). Hardhat's plugins prefer ethers v6, hence `--legacy-peer-deps`. Compilation works cleanly under either; only the bundled `npx hardhat test` requires ethers v6, so if you want to run the test suite locally do `npm install --save-dev ethers@^6` in a separate worktree to avoid breaking server.js.

---

## 3. Compile

```bash
npx hardhat compile
# → "Compiled NN Solidity files successfully (evm target: cancun)."
```

Outputs land in `artifacts/`. Clean ABI-only files for the frontend / Workers are written to `artifacts/abis/` (committed) on every deploy.

---

## 4. Deploy to Base Sepolia first

```bash
npm run deploy:contracts:testnet
# or:  npx hardhat run scripts/deploy.js --network base-sepolia
```

Expected output:

```
--------------------------------------------------
Network    : base-sepolia (chainId 84532)
Deployer   : 0xYour…
USDC token : 0x036CbD53842c5426634e7929541eC2318f3dCF7e
--------------------------------------------------

TokenomicCertificate deployed: 0xCERT_ADDRESS
TokenomicMarket      deployed: 0xMARKET_ADDRESS

Linking Certificate.market = Market ...
  done. tx: 0x…

ABIs + addresses written to artifacts/abis/

Next: verify on Basescan:
  npx hardhat verify --network base-sepolia 0xCERT_ADDRESS 0xYourDeployer
  npx hardhat verify --network base-sepolia 0xMARKET_ADDRESS 0xYourDeployer 0x036CbD53842c5426634e7929541eC2318f3dCF7e 0xCERT_ADDRESS
```

`artifacts/abis/deployment-84532.json` records the addresses.

### 4.1 Smoke-test on testnet

1. As **owner**: `addCourse(1, educator, consultant, 100_000_000)` → registers a 100 USDC course.
2. As **buyer**: `usdc.approve(market, 100_000_000)` then `market.purchase(1, "ipfs://Qm…/cert.json")`.
3. Confirm:
   - Educator received 90 USDC, consultant 5 USDC, platform owner 5 USDC.
   - Buyer holds 1 NFT in `TokenomicCertificate`; `tokenURI(1)` returns the IPFS URI you passed in.
   - `hasPurchased(1, buyer)` is `true` and a second purchase reverts with `AlreadyPurchased`.

---

## 5. Deploy to Base mainnet

```bash
npm run deploy:contracts
# or:  npx hardhat run scripts/deploy.js --network base
```

Records land in `artifacts/abis/deployment-8453.json`. **Default mainnet USDC**:
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

---

## 6. Verify on Basescan

```bash
npx hardhat verify --network base \
  <CERT_ADDRESS> <DEPLOYER_ADDRESS>

npx hardhat verify --network base \
  <MARKET_ADDRESS> <DEPLOYER_ADDRESS> <USDC_ADDRESS> <CERT_ADDRESS>
```

Hardhat reads `BASESCAN_API_KEY` from your `.env`.

---

## 7. ABIs

The full ABI JSON files are emitted on every compile/deploy:

| File | Used by |
| --- | --- |
| `artifacts/abis/TokenomicCertificate.json` | frontend wallet integration, web3-worker |
| `artifacts/abis/TokenomicMarket.json` | frontend Buy button, web3-worker proxy |
| `artifacts/abis/deployment-<chainId>.json` | deployer audit log |

> Tip: import `artifacts/abis/*.json` directly from the Cloudflare web3-worker (Prompt 4) to avoid hand-maintaining ABI literals.

### 7.1 Key event/function signatures (quick reference)

`TokenomicMarket`:

```solidity
event CoursePurchased(
  uint256 indexed courseId,
  address indexed buyer,
  uint256 totalPaid,
  uint256 educatorAmount,
  uint256 consultantAmount,
  uint256 platformAmount,
  uint256 certificateTokenId
);

function purchase(uint256 courseId, string calldata ipfsMetadataURI) external returns (uint256);
function addCourse(uint256 courseId, address educator, address consultant, uint256 price) external;
function updateCourse(uint256 courseId, address educator, address consultant, uint256 price, bool active) external;
function quoteSplit(uint256 price, bool hasConsultant) external pure returns (uint256, uint256, uint256);
function hasPurchased(uint256 courseId, address user) external view returns (bool);
function getCourse(uint256 courseId) external view returns (Course memory);
```

`TokenomicCertificate`:

```solidity
event CertificateMinted(address indexed to, uint256 indexed tokenId, uint256 indexed courseId, string uri);

function mint(address to, uint256 courseId, string calldata ipfsURI) external returns (uint256); // onlyMarket
function setMarket(address market) external; // onlyOwner
function setDefaultRoyalty(address receiver, uint96 feeNumerator) external; // onlyOwner
function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external; // onlyOwner
function tokenURI(uint256 tokenId) external view returns (string memory);
function tokenIdToCourseId(uint256 tokenId) external view returns (uint256);
```

---

## 8. Frontend / Workers integration

Buying flow from the browser (Prompt 1's web3-ui calls):

```js
import { ethers } from 'ethers';
import marketAbi from '/abis/TokenomicMarket.json';
import usdcAbi from '/abis/usdc.json';

async function buyCourse(courseId, priceUsdc, ipfsMetadataURI) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer   = provider.getSigner();
  const usdc     = new ethers.Contract(USDC_ADDRESS, usdcAbi, signer);
  const market   = new ethers.Contract(MARKET_ADDRESS, marketAbi.abi, signer);

  // 1. Approve USDC
  const approveTx = await usdc.approve(MARKET_ADDRESS, priceUsdc);
  await approveTx.wait();

  // 2. Purchase + mint certificate atomically
  const tx = await market.purchase(courseId, ipfsMetadataURI);
  const rcpt = await tx.wait();
  return rcpt.transactionHash;
}
```

Reading certificate ownership from the **web3-worker** (Prompt 4):

```bash
curl https://tokenomic.org/api/web3/erc721/<CERT_ADDRESS>/<student_wallet>
# → { ok: true, balance: 1, owns: true }
```

For activity feeds, index `CoursePurchased` and `CertificateMinted` events through your favorite indexer (Goldsky, Envio, The Graph) or a small Worker that paginates `eth_getLogs`.

---

## 9. Security notes

- **Reentrancy:** `purchase()` is `nonReentrant` and follows checks-effects-interactions. Token transfers happen before the external `certificate.mint()` call.
- **Splits:** static constants enforced at deploy time (`EDUCATOR_BPS + CONSULTANT_BPS + PLATFORM_BPS == 10_000`). Changing the split requires a new market contract — intentional, not a bug.
- **Duplicate purchases:** `hasPurchased[courseId][buyer]` blocks a buyer from minting a second cert for the same course. Owners can reset by deploying a new course id.
- **Certificate authority:** only the market may mint. Owner can rotate the market via `setMarket()` (e.g. for a market upgrade); doing so mid-flight will brick in-flight transactions but will not affect existing certificates.
- **USDC:** uses `SafeERC20`; resilient to non-standard ERC-20s. Default Base USDC is the standards-compliant Circle token.
- **Ownership:** transfer ownership via `transferOwnership(newOwner)` after deployment if the deployer key is hot.
- **Royalties:** start at 0%. Set per-token royalties to credit educators on secondary sales (`setTokenRoyalty(tokenId, educator, 500)` = 5%).
- **Audit:** these contracts are intentionally small. Consider a third-party audit before holding non-trivial USDC balances.

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Function "mcopy" not found` during compile | hardhat.config.js sets `evmVersion: "cancun"` already; make sure you're on Solidity 0.8.24+. |
| `npm install` fails with `ERESOLVE` | Use `--legacy-peer-deps`; the conflict is the deliberate ethers v5 pin. |
| `npx hardhat test` fails with `getAddress is not a function` | Tests need ethers v6. Either run them in a fresh checkout with `npm i -D ethers@^6`, or use Foundry/Forge for unit tests. Compilation and deployment still work with the existing setup. |
| `Error: insufficient funds` | Deployer needs ETH on the chosen network. Use the Base bridge or Base Sepolia faucet. |
| `Etherscan returned 'NOTOK': Missing or unsupported chainid` | Ensure `BASESCAN_API_KEY` is set and you used `--network base` / `base-sepolia` (not `mainnet`/`sepolia`). |
| `purchase` reverts `ERC20: insufficient allowance` | Buyer forgot to call `usdc.approve(marketAddress, price)` first. |
| `purchase` reverts `AlreadyPurchased` | Same wallet already minted this course. Use a different wallet or course id. |

---

## 11. File reference

| File | Role |
| --- | --- |
| `contracts/TokenomicMarket.sol` | USDC marketplace + 90/5/5 split + cert mint |
| `contracts/TokenomicCertificate.sol` | ERC-721 + ERC-2981 NFT, market-only mint |
| `contracts/mocks/MockUSDC.sol` | Test-only 6-decimal stablecoin |
| `hardhat.config.js` | Solidity 0.8.24 / cancun, Base + Base Sepolia networks, Basescan verify |
| `scripts/deploy.js` | Deploys both contracts, wires market, dumps ABIs |
| `test/TokenomicMarket.test.js` | 90/5/5 + 90/10 + duplicate guard + onlyMarket coverage |
| `.env.example` | RPC + key + USDC + Basescan placeholders |
| `artifacts/abis/*.json` | ABI snapshots used by the frontend & Workers |

The payment + certificate system is now fully on-chain with automatic splits and NFT ownership.
