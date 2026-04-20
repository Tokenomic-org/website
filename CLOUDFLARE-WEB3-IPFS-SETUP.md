# Cloudflare Web3 Gateways + IPFS Hosting Setup

This guide makes the entire Tokenomic site available over **IPFS** with a custom **Cloudflare IPFS Gateway** (DNSLink) and adds a dedicated **Cloudflare Ethereum Gateway** for read-only RPC. After completing it, `https://tokenomic.org` resolves through IPFS and your frontend can read Base mainnet via your own gateway URL.

> **Stack used**
> - Static site → built by Jekyll into `_site/`
> - Pinning service → [`nft.storage`](https://nft.storage) (free, no credit card)
> - DNS + gateways → Cloudflare (Web3 product line)
> - Upload script → `scripts/upload-to-ipfs.js` (already in this repo)

---

## 1. Create a Cloudflare IPFS Gateway for `tokenomic.org`

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com).
2. Open **Web3 → Manage gateways → Create gateway**.
   - Direct doc: <https://developers.cloudflare.com/web3/how-to/manage-gateways/>
3. Choose **IPFS** as the gateway type.
4. Pick the **DNSLink** routing mode (recommended — lets you swap CIDs without changing the gateway).
   - Direct doc: <https://developers.cloudflare.com/web3/ipfs-gateway/concepts/dnslink/>
5. Configure:
   - **Hostname:** `ipfs.tokenomic.org` (or whatever subdomain you prefer — you can also point the apex `tokenomic.org` here in step 4 below).
   - **Zone:** select `tokenomic.org`.
   - **DNSLink target:** leave blank for now — you will fill it in after step 2.
6. Click **Create**. Cloudflare auto-provisions the SSL certificate and the CNAME record.

> _Screenshot placeholder: Cloudflare → Web3 → Create gateway form, with **IPFS** + **DNSLink** selected._

---

## 2. Upload `_site/` to IPFS via `nft.storage`

### 2.1 Get a free API key

1. Go to <https://nft.storage> and sign in (GitHub or email — no credit card).
2. Open **API Keys → New Key** and give it a name like `tokenomic-deploy`.
3. Copy the token.

### 2.2 Install dependencies (one-time)

```bash
npm install nft.storage files-from-path mime
```

### 2.3 Build and upload

```bash
# Make sure the static site is fresh
npm run build:web3
bundle exec jekyll build

# Provide your key (do NOT commit it)
export NFT_STORAGE_API_KEY="<paste_your_key_here>"

# Upload everything in _site/ to IPFS
node scripts/upload-to-ipfs.js
```

The script prints something like:

```
========================================
 Upload complete in 12.3s
========================================
 CID: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 Files: 239

 Public gateways:
   Cloudflare: https://cloudflare-ipfs.com/ipfs/bafybeigd.../
   ipfs.io:    https://ipfs.io/ipfs/bafybeigd.../
   dweb.link:  https://dweb.link/ipfs/bafybeigd.../

 Next steps:
  1. Add this DNS record at your registrar (or Cloudflare DNS):
     Name:  _dnslink.tokenomic.org
     Type:  TXT
     Value: dnslink=/ipfs/bafybeigd...
========================================
```

The script also writes `.last-ipfs-cid.json` for CI consumption.

> **CLI flags**
> - `--dir <path>` upload a different folder (default `_site`)
> - `--name <label>` attach a friendly name to the upload
> - `--json` print only JSON (useful in GitHub Actions)

---

## 3. Add the `_dnslink.tokenomic.org` TXT record

In **Cloudflare → DNS → Records → Add record**:

| Field   | Value                                                         |
|---------|---------------------------------------------------------------|
| Type    | `TXT`                                                         |
| Name    | `_dnslink.tokenomic.org` (Cloudflare may show this as `_dnslink`) |
| Content | `dnslink=/ipfs/<YOUR_CID>` (paste the CID from step 2)        |
| TTL     | `Auto`                                                        |
| Proxy   | DNS only (gray cloud)                                         |

Click **Save**.

> Doc: <https://developers.cloudflare.com/web3/ipfs-gateway/concepts/dnslink/>

---

## 4. Make `tokenomic.org` serve via IPFS

You have two options. Pick one — **don't run both**.

### Option A — Full decentralization (recommended)

Point your apex (or `www`) at the IPFS gateway you created in step 1.

1. **Cloudflare → DNS → Add record**:
   | Type  | Name  | Target               | Proxy   |
   |-------|-------|----------------------|---------|
   | CNAME | `@`   | `ipfs.tokenomic.org` | Proxied |
   | CNAME | `www` | `ipfs.tokenomic.org` | Proxied |

   _(If your apex already points to Cloudflare Pages, delete those records first.)_

2. Cloudflare automatically resolves the DNSLink TXT and serves your site from IPFS.

3. Test:
   ```bash
   curl -I https://tokenomic.org
   # Expect: x-ipfs-path or cf-cache-status headers from the IPFS gateway
   ```

### Option B — Hybrid: keep Cloudflare Pages as primary, expose IPFS at a subdomain

Keep your existing Pages deployment as-is and only expose the IPFS mirror at the subdomain you created in step 1 (`https://ipfs.tokenomic.org`). This is the safest "test in production" path:

- Visitors keep using Pages at `tokenomic.org`.
- Anyone curious can see the same site at `https://ipfs.tokenomic.org`.
- When you're ready to flip, swap the apex CNAME from Pages to `ipfs.tokenomic.org`.

---

## 5. Create a Cloudflare Ethereum Gateway (mainnet RPC)

This gives you a **first-party RPC URL** the frontend can call without leaking your wallet provider's API key.

1. **Web3 → Manage gateways → Create gateway**.
2. Choose **Ethereum** as the gateway type.
   - Doc: <https://developers.cloudflare.com/web3/ethereum-gateway/>
3. Configure:
   - **Hostname:** `eth.tokenomic.org`
   - **Zone:** `tokenomic.org`
   - **Network:** Ethereum mainnet (and create a second gateway for **Base** when Cloudflare exposes it under your account, or keep using `https://mainnet.base.org` directly).
4. Click **Create**. The gateway is now reachable as `https://eth.tokenomic.org`.

5. Quick sanity check:
   ```bash
   curl -X POST https://eth.tokenomic.org \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```
   You should see `{"jsonrpc":"2.0","id":1,"result":"0x..."}`.

### 5.1 Expose the RPC URL to the frontend (Cloudflare Pages env vars)

1. **Workers & Pages → tokenomic → Settings → Environment variables**.
2. Add the following to **Production** and **Preview**:

   | Name                          | Example value                                                    |
   |-------------------------------|------------------------------------------------------------------|
   | `VITE_CLOUDFLARE_ETH_GATEWAY` | `https://eth.tokenomic.org`                                      |
   | `VITE_BASE_RPC_URL`           | `https://mainnet.base.org` _(swap to your CF Base gateway later)_ |
   | `VITE_USDC_CONTRACT`          | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                     |

3. The next Pages build will pick them up. To consume them in the static site, write a tiny Liquid include (e.g. `_includes/env.html`) that emits:
   ```html
   <script>
     window.__TKN_ENV = {
       BASE_RPC_URL: "{{ site.env.VITE_BASE_RPC_URL | default: 'https://mainnet.base.org' }}",
       ETH_RPC_URL:  "{{ site.env.VITE_CLOUDFLARE_ETH_GATEWAY | default: '' }}",
       USDC:         "{{ site.env.VITE_USDC_CONTRACT | default: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }}"
     };
   </script>
   ```
   Then `web3-bundle-src.js` can read `window.__TKN_ENV.BASE_RPC_URL` instead of the hardcoded URL.

---

## 6. Automate CID updates on every deploy (optional but recommended)

Add the snippet below to a new GitHub Actions workflow (e.g. `.github/workflows/ipfs-deploy.yml`) so every push to `main` re-pins the latest `_site/` and updates the DNSLink TXT record automatically.

```yaml
name: Pin _site to IPFS and update DNSLink

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  pin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: ruby/setup-ruby@v1
        with: { ruby-version: '3.2', bundler-cache: true }

      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }

      - run: npm install nft.storage files-from-path mime
      - run: npm run build:web3
      - run: bundle exec jekyll build

      - name: Upload to IPFS
        id: ipfs
        env:
          NFT_STORAGE_API_KEY: ${{ secrets.NFT_STORAGE_API_KEY }}
        run: |
          node scripts/upload-to-ipfs.js --json > ipfs.json
          echo "cid=$(node -p "require('./ipfs.json').cid")" >> "$GITHUB_OUTPUT"

      - name: Update Cloudflare DNSLink TXT record
        env:
          CF_API_TOKEN:  ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CF_ZONE_ID:    ${{ secrets.CLOUDFLARE_ZONE_ID }}
          CID:           ${{ steps.ipfs.outputs.cid }}
        run: |
          # Find existing _dnslink record (if any)
          REC=$(curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
            "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?type=TXT&name=_dnslink.tokenomic.org" \
            | node -p "JSON.parse(require('fs').readFileSync(0)).result[0]?.id || ''")

          BODY=$(printf '{"type":"TXT","name":"_dnslink.tokenomic.org","content":"dnslink=/ipfs/%s","ttl":120}' "$CID")

          if [ -n "$REC" ]; then
            curl -s -X PUT -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
              "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$REC" -d "$BODY"
          else
            curl -s -X POST -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
              "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" -d "$BODY"
          fi
```

Required GitHub repo secrets:

| Secret                  | Where to get it                                                                  |
|-------------------------|----------------------------------------------------------------------------------|
| `NFT_STORAGE_API_KEY`   | <https://nft.storage> → API Keys                                                 |
| `CLOUDFLARE_API_TOKEN`  | already added in Prompt 2 (needs the **Zone → DNS → Edit** permission added)     |
| `CLOUDFLARE_ZONE_ID`    | Cloudflare → tokenomic.org overview page (right sidebar)                         |

---

## 7. Final verification

```bash
# 1. Confirm the DNSLink TXT record is live
dig +short TXT _dnslink.tokenomic.org
# expect: "dnslink=/ipfs/bafybeigd..."

# 2. Hit the public Cloudflare gateway with your CID
curl -I https://cloudflare-ipfs.com/ipfs/<YOUR_CID>/

# 3. If you switched the apex (Option A), test the live site
curl -I https://tokenomic.org/
# Look for headers like x-ipfs-path or cf-ray + 200 OK

# 4. Test your Ethereum gateway
curl -X POST https://eth.tokenomic.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# expect: {"jsonrpc":"2.0","id":1,"result":"0x1"}
```

---

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `dig +short TXT _dnslink.tokenomic.org` returns nothing | Wait 1–10 min for DNS propagation. Make sure the record is **DNS only** (gray cloud), not proxied. |
| Cloudflare gateway returns `404` for your CID | nft.storage occasionally needs a minute to propagate. Retry the public `https://cloudflare-ipfs.com/ipfs/<CID>/` URL first. |
| Site loads but assets 404 | Your Jekyll URLs probably contain absolute paths like `/assets/...`. They work via DNSLink (root-mounted), but **path-based** gateway URLs (`/ipfs/<cid>/...`) need relative paths. Stick to DNSLink. |
| `npm install nft.storage` fails with peer-dep warnings | That's normal on Node 20+. The script still runs. |
| `node scripts/upload-to-ipfs.js` exits with auth error | Re-export `NFT_STORAGE_API_KEY` in the same shell. Tokens are case sensitive and have no spaces. |
| Cloudflare Web3 menu missing | Web3 gateways require an active zone on Cloudflare. Add `tokenomic.org` to Cloudflare DNS first. |
| nft.storage upload limits | Free tier supports per-file sizes up to 31 GiB and unlimited requests for static-site use cases. For mission-critical content, also pin to a second provider (e.g. Pinata) for redundancy. |
| You want to migrate to web3.storage / Storacha | Swap `require('nft.storage')` for `@web3-storage/w3up-client`. The rest of the script (file walk, CID logging, DNS update) is identical. |

---

## File reference

| File                                  | Purpose                                                |
|---------------------------------------|--------------------------------------------------------|
| `scripts/upload-to-ipfs.js`           | Walks `_site/` and pins to nft.storage                 |
| `.last-ipfs-cid.json`                 | (gitignored) latest CID + URLs from the last upload    |
| `CLOUDFLARE-WEB3-IPFS-SETUP.md`       | This guide                                             |
| `.github/workflows/ipfs-deploy.yml`   | (optional) auto-pin + DNSLink update on every push     |

---

That's everything. Run the upload once by hand to confirm the flow, then let GitHub Actions take over.
