# Full Ownership Flow (Prompt 7)

End-to-end Web3 ownership across Tokenomic: educators upload → students buy
→ NFT minted atomically → educators withdraw — all on Base L2.

---

## 1. What's on-chain

### `TokenomicMarket.sol` (extended)

| Function | Caller | Purpose | Pays gas |
|---|---|---|---|
| `registerCourse(ipfsMetadataURI, priceInUSDC, consultant)` | **anyone** (caller becomes the educator) | Permissionless self-publish | **educator** |
| `purchase(courseId)` | student (after `usdc.approve`) | Pulls USDC, credits balances. Does **not** mint cert. | **student** |
| `claimCertificate(courseId, ipfsMetadataURI)` | student (after a prior `purchase`) | Mints the ERC-721 cert with the supplied IPFS URI | **student** |
| `mintCertificatesForBuyers(courseId, buyers[], uris[])` | educator (optional, sponsored mode) | Educator-paid batch mint for buyers who haven't claimed yet | **educator** |
| `withdrawUSDC()` | educator / consultant | Pull pending USDC credit | **educator / consultant** |
| `withdrawPlatformFees(to)` | **owner only** | Sweep accumulated 5 % platform cut | **owner** |
| `getCoursesByEducator(addr)` view | dashboard | List courses by educator | — |
| `pendingWithdrawals(addr)` / `totalEarned(addr)` view | dashboard | Earnings panel | — |
| `certificateOf(courseId, addr)` view | dashboard | Returns claimed tokenId (0 if not yet claimed) | — |

## Gas Fee Responsibility

All actions on Base are paid by the wallet that signs the transaction — there
is no platform sponsorship and no meta-transactions.

- **Educators / consultants** pay gas for `registerCourse`, `withdrawUSDC`,
  and the optional `mintCertificatesForBuyers` sponsored batch.
- **Students** pay gas for `purchase` and the separate `claimCertificate`
  call that mints their NFT. Splitting the mint out of the purchase keeps
  on-chain control with the buyer (they decide when, and pay for it
  themselves) and removes any platform-paid gas exposure.
- **Owner** pays gas for `withdrawPlatformFees` sweeps.

The frontend surfaces an estimated ETH cost before each signature via
`TokenomicAssets.estimateActionGas('purchase' | 'claim' | 'register' | 'withdraw', params)`.

Purchase emits both `CoursePurchased` (legacy) and a new
`PurchaseSettled(courseId, buyer, educator, consultant, …, ipfsMetadataURI)`
event indexed by buyer **and** educator — used by the dashboard to render
"Recent sales" without an indexer.

### `TokenomicCertificate.sol` (unchanged)

ERC-721 + ERC-2981, soulbound-friendly, `mint(to, courseId, ipfsURI)` only
callable by the bound market.

Recompile + refresh the frontend ABI:

```bash
npx hardhat compile
node -e "const a=require('./artifacts/contracts/TokenomicMarket.sol/TokenomicMarket.json'); \
         require('fs').writeFileSync('./artifacts/abis/TokenomicMarket.json', \
         JSON.stringify({contractName:'TokenomicMarket',abi:a.abi},null,2));"
```

---

## 2. Educator upload UI

`shared/assets/js/web3-upload.js` exposes `window.TokenomicUpload`:

```js
TokenomicUpload.publishCourse({
  title, description, files: [File], priceInUSDC, consultant,
  onProgress: (stage, info) => …
}); // -> { courseId, txHash, metadataURI, fileCids }
TokenomicUpload.bindForm(formEl, opts);
```

Pinning order:
1. If `__TKN_ENV.IPFS_UPLOAD_BASE` is set, POST to the Cloudflare Worker
   (`POST /ipfs/upload` for files — `multipart/form-data` with a `file`
   field; `POST /ipfs/upload-json` for metadata JSON) — **recommended**,
   keeps the `NFT_STORAGE_TOKEN` server-side. Both endpoints are
   implemented in `workers/api-worker/index.js` with per-IP rate limiting
   and a configurable `MAX_UPLOAD_BYTES` guard (default 25 MB).
2. Else fall back to direct nft.storage with `__TKN_ENV.NFT_STORAGE_TOKEN`
   — **dev-only**. `_includes/env.html` intentionally does *not* emit this
   variable in production builds; never set it in Pages prod env.

The form lives at `dashboard/courses.html → #educator-upload-card` with
fields: `title`, `description`, `priceInUSDC`, `consultant`, multi-file
`files`. Status / progress / result slots use the
`data-tkn-upload-{status,progress,result,submit}` attributes.

---

## 3. Educator/Consultant dashboard

**Revenue → `/revenue/`**
- Pending USDC + lifetime earned.
- "Withdraw to wallet" button (calls `withdrawUSDC()`, shows BaseScan link).
- "My Registered Courses" table (price / active / IPFS link).
- "Recent Sales" table from `PurchaseSettled` events filtered by educator.

**Profile → `/profile/`**
- Tokenomic Score widget (see §4).
- Existing wallet summary + on-chain certificates.

**My Courses → `/my-courses/`** — adds the publish-on-chain form.
(The public listing stays at `/courses/`; the dashboard page was moved to
`/my-courses/` to avoid the Jekyll permalink collision, and every
dashboard sidebar now links to it.)

**Dashboard home → `/dashboard/`** — adds an "On-Chain Ownership" card
linking to publish, earnings, score, certificates.

All panels listen for `tokenomic:wallet-connected` and refresh when the
user connects a wallet.

---

## 4. Tokenomic Score (`getTokenomicScore`)

Pure on-chain read, no extra contract:

```
score = ownedCertificates * 10
      + lifetimePurchases * 5
      + coursesRegistered * 8
      + min(50, log10(totalEarnedUSDC + 1) * 20)
```

Returned as `{ score, breakdown }`. Easy to swap for an on-chain reputation
contract later — call site is `TokenomicAssets.getTokenomicScore(address)`.

---

## 5. Local end-to-end test (Anvil / Hardhat node)

```bash
# Terminal A
npx hardhat node            # chain 31337, prefunded accounts

# Terminal B
npx hardhat run scripts/test-full-flow.js --network localhost
```

The script:
1. Deploys MockUSDC + Certificate + Market.
2. Educator registers a course at 49.99 USDC with a consultant.
3. Student approves & purchases → asserts NFT ownership.
4. Educator withdraws, consultant withdraws, owner sweeps platform fees.
5. Reads back `getCoursesByEducator` + `PurchaseSettled` events.

Expected output ends with `✅ End-to-end flow OK`.

> **Note on Hardhat tests:** the project keeps `ethers v5` for the Express
> backend + frontend CDN (`server.js` uses `ethers.utils.verifyMessage`).
> Hardhat was installed with `--legacy-peer-deps`. The `test-full-flow.js`
> script uses `hre.ethers` which works against the bundled provider.

---

## 6. Base Sepolia smoke test

Set in `.env`:

```bash
PRIVATE_KEY=0x…                     # funded with Sepolia ETH + USDC
BASE_SEPOLIA_RPC=https://sepolia.base.org
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # Circle Sepolia USDC
BASESCAN_API_KEY=…
```

Then:

```bash
npx hardhat run scripts/deploy.js --network base-sepolia
# Note the printed market + certificate addresses.

# Optional smoke run (re-uses USDC_ADDRESS env var):
USDC_ADDRESS=0x036C... npx hardhat run scripts/test-full-flow.js --network base-sepolia
```

Set the Cloudflare Pages env vars for the frontend:

| Var | Value |
|---|---|
| `BASE_CHAIN_ID` | `84532` (Sepolia) or `8453` (mainnet) |
| `MARKET_CONTRACT` | deployed `TokenomicMarket` address |
| `CERTIFICATE_CONTRACT` | deployed `TokenomicCertificate` address |
| `IPFS_UPLOAD_BASE` | URL of `tokenomic-api` Worker (for pinning) |

Then redeploy Pages — the `_includes/env.html` will emit them as
`window.__TKN_ENV`.

---

## 7. Files modified / created

- `contracts/TokenomicMarket.sol` — `registerCourse`, `withdrawUSDC`,
  `withdrawPlatformFees`, balance/credit model, `PurchaseSettled` event,
  `getCoursesByEducator`, `getCourseMetadataURI`.
- `artifacts/abis/TokenomicMarket.json` — regenerated.
- `shared/assets/js/web3-upload.js` *(new)* — IPFS pinning + form binder.
- `shared/assets/js/web3-assets.js` — extended ABI;
  `_getMarketSigner`/`_getMarketReadOnly`; `getEducatorEarnings`,
  `getEducatorCourses`, `getEducatorSales`, `withdrawEarnings`,
  `registerCourseOnChain`, `getTokenomicScore`.
- `dashboard/courses.html` — publish-on-chain form (permalink
  `/my-courses/`; dashboard sidebars updated to match).
- `dashboard/revenue.html` — earnings + withdraw + my courses + recent sales.
- `dashboard/profile.html` — Tokenomic Score widget.
- `dashboard/index.html` — On-Chain Ownership quick-link card.
- `_layouts/{default,dashboard}.html` — load `web3-upload.js`.
- `scripts/test-full-flow.js` *(new)* — end-to-end simulation.
- `FULL-OWNERSHIP-FLOW.md` *(this file)*.

---

## 8. Screenshots placeholders

- `docs/screens/educator-upload.png` — publish-course form.
- `docs/screens/dashboard-earnings.png` — pending USDC + withdraw button.
- `docs/screens/dashboard-sales.png` — recent sales table.
- `docs/screens/profile-score.png` — Tokenomic Score widget.
- `docs/screens/student-cert.png` — newly minted certificate card.
