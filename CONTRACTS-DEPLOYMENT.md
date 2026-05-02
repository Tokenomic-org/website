# Tokenomic Smart Contracts — Deployment Guide

The Phase 1 suite is six small Solidity ^0.8.24 contracts targeting **Base L2**, written with Hardhat + OpenZeppelin v5 + the audited [0xSplits](https://docs.0xsplits.xyz/) `SplitMain` for revenue fan-out.

| Contract | Role |
| --- | --- |
| `RoleRegistry`         | OZ AccessControl wrapper. Single source of truth for `EDUCATOR_ROLE`, `PLATFORM_ROLE`, `TREASURY_ROLE`. |
| `ReferralRegistry`     | `setReferrer` once per user; `referrerOf(addr)` view consumed by `SplitsManager`. |
| `SplitsManager`        | Thin wrapper around 0xSplits `SplitMain`. Lazily mints one immutable split per (educator, buyer) pair sized as **educator / referrer / treasury** in 1e6 bps. |
| `CourseAccess1155`     | Soulbound ERC-1155 representing per-course access tokens. `purchase()` pulls USDC and routes it through the per-(educator, buyer) splitter. |
| `CertificateNFT`       | Soulbound ERC-721 + `ERC721URIStorage`. Only `EDUCATOR_ROLE` may mint; holders can self-burn. |
| `SubscriptionManager`  | Monthly USDC subscriptions with `isActive(addr)` and `subscribeMultiple(months)`. |

Legacy `TokenomicMarket` + `TokenomicCertificate` remain in `contracts/` for the still-in-flight Phase 0 frontend; they will be retired by Phases 2–3.

---

## 1. Prerequisites

| You need | How |
| --- | --- |
| Node 20+ | already installed in this repo |
| ethers v6 | already installed (`server.js` was migrated; the v5 `ethers.utils.verifyMessage` callsite is now `ethers.verifyMessage`) |
| A funded EOA on **Base Sepolia** | bridge a tiny amount of Sepolia ETH via [bridge.base.org](https://bridge.base.org/) |
| A funded EOA on **Base mainnet** | same bridge |
| Test USDC on Base Sepolia | <https://faucet.circle.com/> |
| Basescan API key | <https://basescan.org/myapikey> (works for Sepolia + mainnet) |

> ⚠️ Use a brand-new wallet for deployments and only put in enough ETH for gas.

---

## 2. Install + configure

```bash
npm install
cp .env.example .env
# Then edit .env:
#   PRIVATE_KEY=0x...                deployer key
#   BASE_RPC_URL=...                 Base mainnet RPC
#   BASE_SEPOLIA_RPC_URL=...         Base Sepolia RPC
#   BASESCAN_API_KEY=...             for verification
#   PLATFORM_TREASURY=0x...          (optional) defaults to deployer
```

Optional environment knobs read by `scripts/deploy.js`:

| Variable | Default |
| --- | --- |
| `ADMIN_ADDRESS`           | deployer |
| `PLATFORM_TREASURY`       | deployer |
| `USDC_ADDRESS`            | Circle USDC (Base / Base-Sepolia) |
| `SPLIT_MAIN_ADDRESS`      | `0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE` (same on Base + Base-Sepolia) |
| `SUBSCRIPTION_PRICE_USDC` | `9990000` (= 9.99 USDC) |

---

## 3. Compile & test

```bash
npx hardhat compile
npx hardhat test
npx hardhat coverage
```

The Phase 1 contracts hit **100 % line coverage** (RoleRegistry, ReferralRegistry, SplitsManager, CourseAccess1155, CertificateNFT, SubscriptionManager, plus the test-only `MockSplitMain`). The legacy `TokenomicMarket` / `TokenomicCertificate` are intentionally not covered by Phase 1 — their replacement lives in this suite.

---

## 4. Deploy to Base Sepolia

```bash
npm run deploy:contracts:testnet
# i.e.  npx hardhat run scripts/deploy.js --network base-sepolia
```

Expected output (truncated):

```
--------------------------------------------------
Network    : base-sepolia (chainId 84532)
Deployer   : 0xYour…
Admin      : 0xYour…
Treasury   : 0xYour…
USDC       : 0x036CbD53842c5426634e7929541eC2318f3dCF7e
SplitMain  : 0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE
Sub price  : 9990000 (USDC base units)
--------------------------------------------------

Deploying suite...
  ✓ RoleRegistry           0x…
  ✓ ReferralRegistry       0x…
  ✓ SplitsManager          0x…
  ✓ CourseAccess1155       0x…
  ✓ CertificateNFT         0x…
  ✓ SubscriptionManager    0x…

Writing outputs...
  ✓ deployments/base-sepolia.json
  ✓ packages/abi/ updated (6 contracts)

Next steps:
  Verify on Basescan:
    npx hardhat verify --network base-sepolia <RoleRegistry> <admin>
    npx hardhat verify --network base-sepolia <ReferralRegistry>
    npx hardhat verify --network base-sepolia <SplitsManager> <RoleRegistry> <ReferralRegistry> <SplitMain> <USDC> <treasury>
    npx hardhat verify --network base-sepolia <CourseAccess1155> <RoleRegistry> <SplitsManager> <USDC>
    npx hardhat verify --network base-sepolia <CertificateNFT> <RoleRegistry>
    npx hardhat verify --network base-sepolia <SubscriptionManager> <RoleRegistry> <USDC> <treasury> <subPrice>
```

Records:

- **`deployments/base-sepolia.json`** — full record (deployer, admin, treasury, USDC, SplitMain, all six addresses, ISO timestamp).
- **`packages/abi/<Contract>.json`** — ABI plus a `chainId → address` map. Importable from the frontend, Cloudflare Workers, or any tooling without dragging in Hardhat.
- **`packages/abi/index.json`** — single-file index of contracts and per-chain deployments.

### 4.1 Smoke-test on testnet

1. Admin grants `EDUCATOR_ROLE`: `roleRegistry.grantRole(EDUCATOR_ROLE, educator)`.
2. Educator creates a course: `courseAccess.createCourse(99_900000, 900_000, 50_000, 50_000, "ipfs://meta")` (99.90 USDC, 90/5/5 in 1e6 bps).
3. Buyer `usdc.approve(courseAccess, 99_900000)` then `courseAccess.purchase(1)`.
4. Confirm:
   - Buyer's `balanceOf(buyer, 1) == 1`, `safeTransferFrom` reverts with `SoulboundTransfer`.
   - `splitsManager.getSplitFor(educator, buyer, 900_000, 50_000, 50_000)` returns the lazily-deployed split.
   - `purchase()` auto-distributed: `usdc.balanceOf(split) == 0` and `splitMain.withdrawable(educator, USDC) == 99_900000 * 0.9 == 89_910000`. Educator pulls into their wallet with `splitMain.withdraw(educator, 0, [USDC])`.
5. Educator mints a cert: `certificateNFT.mint(buyer, 1, "ipfs://cert.json")`.
6. Subscription smoke: `subscriptionManager.subscribe()` after `usdc.approve(sub, 9_990000)`. USDC moves directly to the treasury address.

---

## 5. Deploy to Base mainnet

The script refuses mainnet deploys without an explicit confirmation flag:

```bash
CONFIRM_MAINNET=1 npm run deploy:contracts
# i.e.  CONFIRM_MAINNET=1 npx hardhat run scripts/deploy.js --network base
```

Records land in `deployments/base.json`. Default mainnet USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

---

## 6. Verify on Basescan

`scripts/deploy.js` prints the exact six `npx hardhat verify` invocations needed (with constructor args). Hardhat reads `BASESCAN_API_KEY` from your `.env`.

---

## 7. ABIs (`packages/abi/`)

```
packages/abi/
  index.json                  # { contracts: [...], deployments: { chainId: { Contract: address } } }
  RoleRegistry.json
  ReferralRegistry.json
  SplitsManager.json
  CourseAccess1155.json
  CertificateNFT.json
  SubscriptionManager.json
```

Each per-contract file has the shape:

```json
{
  "contractName": "CourseAccess1155",
  "abi": [ ... ],
  "addresses": {
    "84532": "0x…",
    "8453":  "0x…"
  }
}
```

The frontend bundle and the Cloudflare Workers should import directly from this directory rather than maintaining hand-typed ABI literals.

---

## 8. Wrangler vars to update post-deploy

After mainnet/testnet deploys, mirror the addresses into `wrangler.toml [vars]`:

```toml
ROLE_REGISTRY        = "0x…"
REFERRAL_REGISTRY    = "0x…"
SPLITS_MANAGER       = "0x…"
COURSE_ACCESS_1155   = "0x…"
CERTIFICATE_NFT      = "0x…"
SUBSCRIPTION_MANAGER = "0x…"
```

(Phase 2/3 will wire these into the API worker and the frontend env.)

---

## 9. Security notes

- **Auto-distribution:** `CourseAccess1155.purchase` calls `SplitsManager.fundSplit` *and* `SplitsManager.distribute` in the same tx, so each recipient (educator, optional referrer, treasury) is credited inside SplitMain immediately. Recipients still pull their balance with `SplitMain.withdraw` — that is the standard 0xSplits push-credit / pull-wallet model.
- **Reentrancy:** `CourseAccess1155.purchase` and `SubscriptionManager.subscribe*` are `nonReentrant`; both follow checks-effects-interactions and use `SafeERC20`.
- **Soulbound:** Both `CourseAccess1155` (`_update` hook) and `CertificateNFT` (`_update` override) revert with `SoulboundTransfer` on any transfer between non-zero addresses. Mints and burns remain open.
- **Splits:** Bps inputs are validated to sum to `1_000_000` (1e6) per 0xSplits convention. Recipients are sorted ascending and duplicate addresses are merged before `SplitMain.createSplit` is called. The `(educator, buyer)` cache is keyed by the full bps tuple, so (a) two courses from the same educator with different splits get different splitters per buyer, and (b) a third party who pre-creates a split for a target pair with bogus bps cannot poison subsequent legitimate purchases (the legitimate `purchase()` looks up the cache slot keyed by the *course-configured* bps, not the griefer's).
- **Roles:** `RoleRegistry` is the *only* role authority. Granting / revoking happens once in one place.
- **Mainnet latch:** the deploy script throws unless `CONFIRM_MAINNET=1` is set.

---

## 10. File reference

| File | Role |
| --- | --- |
| `contracts/registries/RoleRegistry.sol`        | OZ AccessControl + named roles |
| `contracts/referrals/ReferralRegistry.sol`     | One-shot referrer mapping |
| `contracts/splits/ISplitMain.sol`              | Minimal 0xSplits interface |
| `contracts/splits/SplitsManager.sol`           | Wrapper that creates per-(educator, buyer) splits |
| `contracts/access/CourseAccess1155.sol`        | Soulbound ERC-1155 access token + USDC purchase |
| `contracts/certificates/CertificateNFT.sol`    | Soulbound ERC-721 educator-minted cert |
| `contracts/subscriptions/SubscriptionManager.sol` | Monthly USDC sub with `isActive` |
| `contracts/mocks/MockUSDC.sol`                 | 6-decimal stablecoin mock for tests |
| `contracts/mocks/MockSplitMain.sol`            | Mock 0xSplits SplitMain for tests |
| `scripts/deploy.js`                            | Deploys the suite + writes ABIs/addresses |
| `test/*.test.js`                               | 100 % line coverage across the suite |
| `deployments/<network>.json`                   | Per-network deploy record |
| `packages/abi/*.json`                          | ABIs + chainId → address maps |
| `hardhat.config.js`                            | Solidity 0.8.24 / cancun, Base + Base-Sepolia, Basescan verify |
| `.env.example`                                 | Env placeholders |
