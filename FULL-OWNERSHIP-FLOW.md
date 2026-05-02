# Full Ownership Flow (Phase 1 — Base L2)

End-to-end on-chain ownership across Tokenomic. Six small contracts, one
audited revenue router, USDC for everything, gas paid by the wallet that
signs.

---

## 1. Contracts and how they fit together

```
                ┌──────────────────┐
                │   RoleRegistry   │  EDUCATOR_ROLE / PLATFORM_ROLE / TREASURY_ROLE
                └─────────┬────────┘
        ┌─────────────────┼──────────────────────────────┐
        │                 │                              │
        ▼                 ▼                              ▼
┌────────────────┐ ┌──────────────┐         ┌────────────────────────┐
│ CourseAccess1155│ │CertificateNFT│         │ SubscriptionManager    │
│  ERC-1155       │ │  ERC-721     │         │   monthly USDC         │
│  soulbound      │ │  soulbound   │         │   isActive(addr)       │
└────────┬────────┘ └──────────────┘         └────────────────────────┘
         │ usdc.transferFrom(buyer, contract, price)
         ▼
┌────────────────┐    createSplit / fundSplit / distribute
│ SplitsManager  │ ────────────────────────────────────────► 0xSplits SplitMain
└────────┬───────┘
         │ reads referrer
         ▼
┌──────────────────┐
│ ReferralRegistry │  setReferrer(referrer) — once per user
└──────────────────┘
```

### Function surface

| Contract | Function | Caller | Purpose |
|---|---|---|---|
| `RoleRegistry`         | `grantRole(EDUCATOR_ROLE, addr)` | `DEFAULT_ADMIN_ROLE` | Onboard an educator |
| `RoleRegistry`         | `grantEducators(addrs[])`        | `DEFAULT_ADMIN_ROLE` | Batch onboard a cohort |
| `ReferralRegistry`     | `setReferrer(referrer)`          | any user (once)      | Bind a referrer for the caller |
| `SplitsManager`        | `createSplitFor(educator, buyer, eduBps, refBps, platBps)` | anyone | Lazily mints the immutable split (idempotent — cache is keyed by `(educator, buyer, eduBps, refBps, platBps)` so per-course economics are preserved and pre-grief is harmless) |
| `SplitsManager`        | `fundSplit(split, amount)`       | called by `CourseAccess1155` | Forwards USDC into the split |
| `SplitsManager`        | `distribute(split)`              | anyone               | Triggers SplitMain to fan funds out |
| `CourseAccess1155`     | `createCourse(price, eduBps, refBps, platBps, uri)` | EDUCATOR_ROLE | Mint a new course token id |
| `CourseAccess1155`     | `updateCourse(id, price, active)` | course's educator | Edit price / pause |
| `CourseAccess1155`     | `setActive(id, active)`          | PLATFORM_ROLE        | Platform takedown |
| `CourseAccess1155`     | `purchase(courseId)`             | buyer (after `approve`) | Pay USDC, fund + auto-distribute the split, receive soulbound 1155 |
| `CertificateNFT`       | `mint(to, courseId, uri)`        | EDUCATOR_ROLE        | Issue a soulbound cert |
| `CertificateNFT`       | `burn(tokenId)`                  | token owner          | Self-burn |
| `SubscriptionManager`  | `subscribe()` / `subscribeMultiple(n)` | subscriber (after `approve`) | Pay N months of USDC |
| `SubscriptionManager`  | `isActive(addr)` view            | anyone               | Gating predicate |

---

## 2. Gas Fee Responsibility

All actions on Base are paid by the wallet that signs the transaction. There
is no platform sponsorship and no meta-transactions in Phase 1.

| Action | Pays gas |
|---|---|
| Admin onboards an educator (`grantRole` / `grantEducators`) | admin |
| Educator publishes a course (`createCourse`) | educator |
| Educator updates price / pauses (`updateCourse`) | educator |
| Educator mints a certificate (`certificateNFT.mint`) | educator |
| Buyer binds a referrer (`setReferrer`) | buyer |
| Buyer purchases (`courseAccess.purchase`) — also lazily creates the split on first buy and auto-distributes the freshly-funded USDC | buyer |
| Educator / referrer / treasury withdraws their accrued USDC from SplitMain | the recipient |
| Subscriber pays monthly (`subscribe`, `subscribeMultiple`) | subscriber |
| Platform updates treasury / monthly price (`setTreasury`, `setMonthlyPrice`) | PLATFORM_ROLE |

The frontend will surface an estimated ETH cost before each signature in
Phase 2/3 (the Phase 0 wallet stack already wires `wagmi`'s
`useEstimateGas` for this).

---

## 3. End-to-end purchase flow

1. **Onboard** — admin calls `roleRegistry.grantRole(EDUCATOR_ROLE, educator)`.
2. **Publish** — educator calls
   `courseAccess.createCourse(99_900000, 900_000, 50_000, 50_000, "ipfs://meta")`
   (99.90 USDC; 90/5/5 in 0xSplits 1e6 bps).
3. **Refer (optional)** — buyer calls
   `referralRegistry.setReferrer(referrerAddr)` exactly once. If they skip
   this step, the would-be 5 % referrer slice folds into the platform
   treasury automatically.
4. **Approve + buy** — buyer calls
   `usdc.approve(courseAccess, 99_900000)` then
   `courseAccess.purchase(1)`. In **one** tx the contract:
   - pulls 99.90 USDC from the buyer;
   - looks up (or lazily creates) the `(educator, buyer, eduBps,
     refBps, platBps)` split via `SplitsManager` — recipients are
     educator / referrer / treasury, sized in 1e6 bps;
   - forwards the 99.90 USDC into the split address;
   - **auto-distributes** by calling `SplitsManager.distribute(split)`,
     which invokes `SplitMain.distributeERC20` and immediately credits
     per-recipient withdrawable balances inside SplitMain;
   - mints the buyer a soulbound `CourseAccess1155` token id 1.
5. **Withdraw** — educator / referrer / treasury each call
   `splitMain.withdraw(addr, 0, [usdcAddress])` whenever they want to
   pull their accumulated share to their wallet (this is the standard
   0xSplits push-credit / pull-wallet pattern; the credit happens at
   purchase time).
6. **Certify** — when the educator marks the course as completed for the
   buyer, they call `certificateNFT.mint(buyer, 1, "ipfs://cert.json")`.
   The cert is soulbound — the buyer cannot transfer it but may
   `burn(tokenId)` themselves.

Subscriptions are independent of courses: any wallet can call
`subscribeMultiple(N)` to get `N` months of access (USDC streams directly
to `treasury`; the contract only stores the expiry timestamp).

---

## 4. Tokenomic Score (off-chain, derived)

The Phase 0 frontend already exposes `TokenomicAssets.getTokenomicScore(addr)`
based on legacy contract reads. In Phase 2/3 the score will be
re-derived from the new suite:

```
score = certCount(addr) * 10
      + courseAccessCount(addr) * 5
      + coursesPublishedBy(addr) * 8
      + isActive(addr) ? 25 : 0
```

No new contract is needed — these are pure view reads.

---

## 5. Local Hardhat tests

```bash
npx hardhat test       # 41 tests across the suite
npx hardhat coverage   # 100 % line coverage on Phase 1 contracts
```

A local end-to-end deploy (with stub USDC + SplitMain addresses, just to
exercise the deploy script) is:

```bash
USDC_ADDRESS=0x000000000000000000000000000000000000DEAD \
SPLIT_MAIN_ADDRESS=0x000000000000000000000000000000000000bEEF \
  npx hardhat run scripts/deploy.js --network hardhat
```

For a real on-chain Base Sepolia smoke run, see `CONTRACTS-DEPLOYMENT.md` §4.

---

## 6. Migration from the legacy contracts

The Phase 0 frontend (`web3-assets.js`, dashboard pages) still calls the
legacy `TokenomicMarket` + `TokenomicCertificate`. Those contracts are
left untouched in `contracts/` so Phase 0 keeps working until Phase 2
swaps the call sites over to the new suite.

| Legacy | Replacement |
|---|---|
| `TokenomicMarket.registerCourse` | `CourseAccess1155.createCourse` (caller must hold EDUCATOR_ROLE) |
| `TokenomicMarket.purchase + claimCertificate` | `CourseAccess1155.purchase` for access + `CertificateNFT.mint` (educator-paid) |
| `TokenomicMarket` 90/5/5 hardcoded split + `pendingWithdrawals` pull model | `SplitsManager` + 0xSplits SplitMain (audited push-then-pull) |
| `TokenomicCertificate` (market-only mint) | `CertificateNFT` (EDUCATOR_ROLE-only mint, soulbound) |
| n/a | `SubscriptionManager` (new monthly USDC sub) |
| n/a | `ReferralRegistry` (new) |

---

## 7. Files added / modified in Phase 1

- `contracts/registries/RoleRegistry.sol`            *(new)*
- `contracts/referrals/ReferralRegistry.sol`         *(new)*
- `contracts/splits/ISplitMain.sol`                  *(new)*
- `contracts/splits/SplitsManager.sol`               *(new)*
- `contracts/access/CourseAccess1155.sol`            *(new)*
- `contracts/certificates/CertificateNFT.sol`        *(new)*
- `contracts/subscriptions/SubscriptionManager.sol`  *(new)*
- `contracts/mocks/MockSplitMain.sol`                *(new)*
- `test/RoleRegistry.test.js`                        *(new)*
- `test/ReferralRegistry.test.js`                    *(new)*
- `test/SplitsManager.test.js`                       *(new)*
- `test/CourseAccess1155.test.js`                    *(new)*
- `test/CertificateNFT.test.js`                      *(new)*
- `test/SubscriptionManager.test.js`                 *(new)*
- `scripts/deploy.js`                                *(rewritten for the new suite, with `CONFIRM_MAINNET=1` latch and `packages/abi/` export)*
- `scripts/test-full-flow.js`                        *(migrated to ethers v6)*
- `server.js`                                        *(`ethers.utils.verifyMessage` → `ethers.verifyMessage`)*
- `package.json`                                     *(ethers ^6, new deploy scripts)*
- `packages/abi/*.json`                              *(ABI + chainId → address maps)*
- `deployments/<network>.json`                       *(written by `scripts/deploy.js`)*
- `CONTRACTS-DEPLOYMENT.md`                          *(rewritten for the new suite)*
- `FULL-OWNERSHIP-FLOW.md`                           *(this file)*
