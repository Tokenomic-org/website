# Frontend Contract Integration (Prompt 6)

This document describes how the Tokenomic Jekyll frontend talks to the
on-chain `TokenomicMarket` and `TokenomicCertificate` contracts deployed in
Prompt 5.

## 1. Runtime configuration

Contract addresses are **never hard-coded**. They are read at page load from
`window.__TKN_ENV`, which is emitted by [`_includes/env.html`](_includes/env.html)
and pulled into both site layouts:

- `_layouts/default.html`
- `_layouts/dashboard.html`

`env.html` reads from Jekyll site config (`site.web3.*`) which Cloudflare
Pages populates from environment variables at build time.

| `window.__TKN_ENV` key | `site.web3` key       | Default                                      |
| ---------------------- | --------------------- | -------------------------------------------- |
| `BASE_CHAIN_ID`        | `base_chain_id`       | `8453`                                       |
| `BASE_RPC_URL`         | `base_rpc_url`        | `https://mainnet.base.org`                   |
| `ETH_GATEWAY_URL`      | `eth_gateway_url`     | `""` (use Cloudflare Web3 ETH gateway)       |
| `USDC_CONTRACT`        | `usdc_contract`       | Base mainnet USDC `0x8335…2913`              |
| `MARKET_CONTRACT`      | `market_contract`     | `""` — must be set after deployment          |
| `CERTIFICATE_CONTRACT` | `certificate_contract`| `""` — must be set after deployment          |
| `BASESCAN_BASE`        | `basescan_base`       | `https://basescan.org`                       |

Set the deployed addresses as Cloudflare Pages env vars (Production +
Preview), then add the matching keys to `_config.yml` `web3:` block, or rely
on the build to pull them via Cloudflare's `JEKYLL_ENV_*` style overrides.

## 2. `web3-assets.js` — what changed

### Buy flow (`buyCourse`)

When `MARKET_CONTRACT` is set, purchases now go through the on-chain market:

1. `USDC.allowance(buyer, market)` is checked; if insufficient, `USDC.approve`
   is sent for the exact course price.
2. `market.purchase(courseId, ipfsMetadataURI)` is called. The contract
   atomically:
   - splits the USDC 90 % educator / 5 % consultant / 5 % platform
     (consultant share folds into platform when no consultant is set);
   - mints the buyer's `TokenomicCertificate` NFT.
3. The frontend parses the `CoursePurchased` event log to surface the
   minted `certificateTokenId`, then registers the asset against the
   backend for off-chain bookkeeping.

If `MARKET_CONTRACT` is empty (e.g. local dev before deployment), the
legacy `USDC.transfer → splitter` path is preserved as a fallback so
nothing breaks.

### Claim flow (`claimCertificate`)

When the market is wired, the certificate is already minted at purchase
time, so `claimCertificate` becomes a refresh: it returns
`{ alreadyMinted: true, certificates: [...] }`. The legacy
`safeMint`-based path remains for environments where only the legacy
backend is configured.

### Reading certificates (`getOwnedCertificates`)

`TokenomicCertificate` intentionally omits `ERC721Enumerable` to save
gas, so the frontend walks `tokenId = 1..nextTokenId-1`, calls
`ownerOf(id)`, and collects matches for the connected wallet. Each entry
returns:

```js
{
  tokenId,                 // string
  courseId,                // string from tokenIdToCourseId
  tokenURI,                // ipfs://...
  ipfsUrl,                 // gateway URL (cloudflare-ipfs.com)
  contract,                // CERTIFICATE_CONTRACT address
  explorerUrl              // BaseScan token page
}
```

Reads use `ETH_GATEWAY_URL` first (Cloudflare ETH gateway) and fall back
to `BASE_RPC_URL`.

## 3. UI wiring (`web3-ui.js`)

`renderMyCertificates()` now:

- Calls `assets.getOwnedCertificates(address)` when both a wallet and
  `CERT_NFT_ADDRESS` are available — pure on-chain truth.
- Falls back to the legacy backend listing (`assets.loadAssets()`) when
  the contract isn't wired or the on-chain read fails.

The dashboard slot `#tkn-my-certificates` (in `dashboard/profile.html`)
is the render target.

## 4. Deployment checklist

1. Deploy the contracts (`npm run deploy:contracts:testnet` or
   `deploy:contracts`). Note the printed addresses.
2. In **Cloudflare Pages → tokenomic → Settings → Environment variables**,
   set:
   - `MARKET_CONTRACT` = deployed `TokenomicMarket` address
   - `CERTIFICATE_CONTRACT` = deployed `TokenomicCertificate` address
   - `BASE_CHAIN_ID` = `84532` (Sepolia) or `8453` (mainnet)
3. Mirror those values into `_config.yml`'s `web3:` block (or pass
   through the Pages build env). Trigger a redeploy.
4. Verify `view-source:` of any page shows
   `window.__TKN_ENV.MARKET_CONTRACT = "0x…"`.
5. Connect a wallet on `/profile/`, buy a course on `/courses/`, and
   confirm the new certificate appears under "My Certificates" with a
   working BaseScan link.

## 5. Files touched

- `_includes/env.html` *(new)*
- `_layouts/default.html` *(adds `{% include env.html %}`)*
- `_layouts/dashboard.html` *(adds `{% include env.html %}`)*
- `shared/assets/js/web3-assets.js` *(MARKET ABI, CERT ABI, `buyCourse`,
  `claimCertificate`, `getOwnedCertificates`,
  `_buildCertificateMetadataURI`)*
- `shared/assets/js/web3-ui.js` *(`renderMyCertificates` now prefers
  on-chain reads)*
