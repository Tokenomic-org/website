# Cloudflare Workers Setup (api-worker + web3-worker)

This guide deploys the two Workers introduced in Prompt 4 and binds them to your existing Cloudflare Pages project so the frontend can call them at `/api/comments/...`, `/api/dashboard/...`, and `/api/web3/...`.

| Worker | Path prefix | Storage | Purpose |
| --- | --- | --- | --- |
| `tokenomic-api` | `/api/comments/*`, `/api/dashboard/*` | Workers KV | Article comments + dashboard aggregates (replaces the `pending_content` Postgres table for comments) |
| `tokenomic-web3` | `/api/web3/*` | None (read-only RPC) | Proxies on-chain reads via Cloudflare Ethereum / Base RPC |

Both Workers use **Hono v4** and include CORS, rate limiting, and structured error responses. The web3 worker uses **ethers v6** on the Workers runtime; this is independent of your `server.js` which still runs ethers v5.

---

## 1. Create the two KV namespaces

1. Cloudflare dashboard → **Workers & Pages → KV → Create a namespace**.
2. Create:
   - `tokenomic-comments`
   - `tokenomic-rate-limits`
3. Copy each namespace's **ID** and **Preview ID** (shown after creation).
4. Open `wrangler.toml` and replace the four `REPLACE_WITH_*` placeholders under `[env.api-worker]`:

   ```toml
   [[env.api-worker.kv_namespaces]]
   binding = "COMMENTS_KV"
   id = "<paste_comments_id>"
   preview_id = "<paste_comments_preview_id>"

   [[env.api-worker.kv_namespaces]]
   binding = "RATE_LIMIT_KV"
   id = "<paste_rate_limits_id>"
   preview_id = "<paste_rate_limits_preview_id>"
   ```

> CLI alternative: `npx wrangler kv namespace create tokenomic-comments` and `... --preview` to auto-mint and print the IDs.

---

## 2. Get / reuse Cloudflare credentials

You already added these in Prompt 2. Confirm they exist as **GitHub repo secrets**:

| Secret | Where | Permissions needed |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub → Settings → Secrets → Actions | Account → Workers Scripts: **Edit**, Account → Workers KV Storage: **Edit**, Zone → Workers Routes: **Edit**, Account → Pages: **Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | same place | n/a |

If your existing token only has Pages permission, regenerate it with the additional Workers scopes above.

---

## 3. Local install + deploy

```bash
# from the repo root
npm install --prefix workers/api-worker
npm install --prefix workers/web3-worker

# Authenticate wrangler once (skips if env vars are already set)
export CLOUDFLARE_API_TOKEN="<your_token>"
export CLOUDFLARE_ACCOUNT_ID="<your_account_id>"

# Deploy both Workers
npx wrangler deploy --env api-worker
npx wrangler deploy --env web3-worker
```

Each command prints a `*.workers.dev` URL — keep them handy for testing in step 5.

---

## 4. Wire the Workers to Cloudflare Pages

You have two ways to make `/api/...` requests from the static site reach the Workers:

### Option A — **Routes on `tokenomic.org`** (recommended)

1. Open `wrangler.toml` and uncomment the `[[env.api-worker.routes]]` and `[[env.web3-worker.routes]]` blocks at the bottom of each section.
2. Re-deploy both Workers.
3. Cloudflare will route `tokenomic.org/api/comments/*`, `tokenomic.org/api/dashboard/*`, and `tokenomic.org/api/web3/*` to the matching Worker, and let Pages serve everything else.

### Option B — **Pages Functions proxy**

If you prefer the Pages dashboard:

1. Create a `functions/api/[[catchall]].ts` file that forwards based on path:
   ```ts
   export const onRequest: PagesFunction = async ({ request, env }) => {
     const url = new URL(request.url);
     const target = url.pathname.startsWith('/api/web3/')
       ? env.WEB3_WORKER
       : env.API_WORKER;
     return target.fetch(new Request(url, request));
   };
   ```
2. In Pages **Settings → Functions → Service bindings**, bind:
   - `API_WORKER` → `tokenomic-api`
   - `WEB3_WORKER` → `tokenomic-web3`

Pick **one** option, not both.

---

## 5. Test the endpoints

Replace `<base>` with either `https://tokenomic.org` (after routing) or the worker's `*.workers.dev` URL.

```bash
# api-worker
curl <base>/api/health
curl <base>/api/comments/example-article
curl -X POST <base>/api/comments/example-article \
  -H 'Content-Type: application/json' \
  -d '{"author":"Alice","text":"Great article!","wallet":"0x0000000000000000000000000000000000000001"}'
curl <base>/api/dashboard/stats
curl <base>/api/dashboard/activity?limit=10

# web3-worker
curl <base>/api/web3/health
curl <base>/api/web3/chain
curl <base>/api/web3/usdc/0x0000000000000000000000000000000000000001
curl <base>/api/web3/eth/0x0000000000000000000000000000000000000001

# Allow-listed JSON-RPC pass-through
curl -X POST <base>/api/web3/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

Rate limit is `10/min/IP` for sensitive routes (`POST /api/comments/*`, `POST /api/web3/rpc`) and surfaces in `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers.

---

## 6. Update the frontend to call the new Workers

The frontend (Prompt 1) currently calls `server.js` paths like `/api/verify-signature`. Add the new endpoints alongside (no breaking changes):

```js
// Example: post a comment from web3-ui.js or an article template
async function postComment(slug, text, wallet) {
  const r = await fetch('/api/comments/' + encodeURIComponent(slug), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, wallet, author: wallet ? wallet.slice(0, 8) : 'Anon' })
  });
  if (!r.ok) throw new Error((await r.json()).error || 'Failed');
  return (await r.json()).comment;
}

// Example: read USDC balance through the Worker (no wallet/RPC in the browser)
async function fetchUSDC(address) {
  const r = await fetch('/api/web3/usdc/' + address);
  const j = await r.json();
  return j.balance;
}
```

Because routes are relative, the same code works in:
- Local dev (Express still serves the static site)
- Cloudflare Pages (Worker routes intercept `/api/...`)
- IPFS gateway (DNSLink resolves to the Pages CNAME, which still routes to Workers)

---

## 7. Add Workers deploy to the existing GitHub Action

The Pages workflow created in Prompt 2 (`.github/workflows/cloudflare-pages-deploy.yml`) has been extended with two extra jobs that run **after** the Pages build succeeds. They install each Worker's dependencies and run `wrangler deploy --env <name>`. No further configuration needed beyond the secrets you already set in step 2.

---

## 8. Environment variables reference

### `tokenomic-api` (`[env.api-worker.vars]`)

| Name | Default | Purpose |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `https://tokenomic.org, *.tokenomic.org, *.cf-ipfs.com, *.pages.dev` | CORS allow-list (comma separated, supports `*.suffix`) |
| `MAX_COMMENT_LEN` | `4000` | Max characters per comment |
| `REQUIRE_WALLET` | `false` | When `"true"`, comments must include a valid 0x address |

### `tokenomic-web3` (`[env.web3-worker.vars]`)

| Name | Default | Purpose |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | same as api-worker | CORS allow-list |
| `BASE_RPC_URL` | `https://mainnet.base.org` | Base L2 JSON-RPC endpoint |
| `CLOUDFLARE_ETH_GATEWAY` | empty | Optional Ethereum mainnet gateway URL from Prompt 3 |

Edit values in `wrangler.toml` then `wrangler deploy --env <name>`. For secrets (e.g. private RPC keys) use `npx wrangler secret put <NAME> --env <env-name>` instead of `vars`.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Error: KV namespace 'COMMENTS_KV' not found` | The placeholder IDs in `wrangler.toml` are not replaced. See step 1. |
| `429 Rate limit exceeded` on first request | Two requests share the same IP at the edge (e.g. Cloudflare Worker + curl from same machine). Wait 60s. |
| `403 Method not allowed` on `/api/web3/rpc` | Add the method to `RPC_ALLOWED_METHODS` in `workers/web3-worker/index.js`. Allow-list is intentional for safety. |
| CORS preflight fails | Add the calling origin to `ALLOWED_ORIGINS` in the relevant `[env.<name>.vars]` block. Wildcards must use `https://*.suffix`. |
| `ReferenceError: process is not defined` | A dependency relies on Node globals. Both workers ship with `compatibility_flags = ["nodejs_compat"]` already set. |
| `wrangler deploy` says "no entry point" | Use the `--env` flag: `wrangler deploy --env api-worker`. The root config is multi-env. |

---

## 10. File reference

| File | Role |
| --- | --- |
| `wrangler.toml` | Multi-env config for both Workers |
| `workers/api-worker/index.js` | Hono app for comments + dashboard |
| `workers/api-worker/package.json` | Worker A dependencies (Hono) |
| `workers/web3-worker/index.js` | Hono app for read-only on-chain proxy |
| `workers/web3-worker/package.json` | Worker B dependencies (Hono + ethers v6) |
| `.github/workflows/cloudflare-pages-deploy.yml` | Pages build + Worker deploys (extended) |
| `wrangler.jsonc` | (Legacy) Workers Static Assets — unchanged, can be removed once Pages is canonical |

When you're done, the dynamic parts of Tokenomic (comments + on-chain reads) run fully on Cloudflare with zero servers.
