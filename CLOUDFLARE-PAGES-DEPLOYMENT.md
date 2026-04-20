# Cloudflare Pages Deployment Guide

This guide walks you through deploying the Tokenomic Jekyll site to **Cloudflare Pages** with automatic builds on every push to `main` and preview deployments on every pull request.

The pipeline lives in `.github/workflows/cloudflare-pages-deploy.yml` and uses the official [`cloudflare/wrangler-action@v3`](https://github.com/cloudflare/wrangler-action).

> **Note on Workers vs. Pages.** This repo also ships a `wrangler.jsonc` for the legacy Workers Static Assets deployment. The Pages workflow below is fully independent — you can run both, or remove `wrangler.jsonc` once Pages is your source of truth.

---

## 1. Create the Cloudflare Pages project

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create application → Pages → Connect to Git**.
3. Authorize Cloudflare to access your GitHub account and select the **`Tokenomic-org/website`** repository.
4. On the **Set up builds and deployments** screen, use these exact settings:

   | Field | Value |
   | --- | --- |
   | Project name | `tokenomic` |
   | Production branch | `main` |
   | Framework preset | `Jekyll` (or `None` if you want full control) |
   | Build command | `npm install && npm run build:web3 && bundle exec jekyll build` |
   | Build output directory | `_site` |
   | Root directory | *(leave blank)* |

5. Click **Save and Deploy**. The first build takes 2–5 minutes; subsequent builds are faster thanks to caching.

> The `npm run build:web3` step compiles the viem-based Web3 bundle before Jekyll runs. If you skip it, the site still works but `/shared/assets/js/web3-bundle.js` will be stale.

---

## 2. Connect the custom domain `tokenomic.org`

1. In the Pages project, open **Custom domains → Set up a custom domain**.
2. Enter `tokenomic.org` and click **Continue**.
3. If the zone is already on Cloudflare, the CNAME is added automatically. Otherwise, follow the on-screen DNS instructions.
4. Repeat the steps for `www.tokenomic.org` and add a redirect rule (`www → root`) under **Rules → Redirect Rules** if desired.
5. SSL/TLS certificates are issued automatically — usually within a few minutes.

---

## 3. Add GitHub repository secrets

The CI workflow needs two secrets to talk to Cloudflare.

1. In Cloudflare, go to **My Profile → API Tokens → Create Token**.
2. Use the **"Edit Cloudflare Workers"** template (or create a custom token with **Account → Cloudflare Pages → Edit** + **Account → Workers Scripts → Edit**).
3. Copy the generated token.
4. Find your **Account ID** on the right sidebar of the Workers & Pages overview page.
5. In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

   | Secret name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the token from step 3 |
   | `CLOUDFLARE_ACCOUNT_ID` | the account ID from step 4 |

> `GITHUB_TOKEN` is provided automatically by Actions — you do not need to create it.

---

## 4. Add build-time environment variables (for future RPC URLs / contracts)

Cloudflare Pages lets you set environment variables that are available **at build time** (so they can be inlined into the Jekyll output).

1. Open **Workers & Pages → tokenomic → Settings → Environment variables**.
2. Add variables under both **Production** and **Preview** environments. Common ones for this project:

   | Variable name | Example value | Purpose |
   | --- | --- | --- |
   | `VITE_BASE_RPC_URL` | `https://mainnet.base.org` | Base L2 JSON-RPC endpoint used by viem |
   | `VITE_BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | Base testnet endpoint for previews |
   | `VITE_USDC_CONTRACT` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | USDC on Base |
   | `VITE_CERT_NFT_CONTRACT` | *(deploy address)* | ERC-721 certification contract |
   | `VITE_REVENUE_SPLITTER_CONTRACT` | *(deploy address)* | Revenue splitter address |
   | `VITE_COURSE_NFT_CONTRACT` | *(deploy address)* | ERC-1155 course access contract |
   | `JEKYLL_ENV` | `production` | Toggles production-only Jekyll features |

3. Click **Save**. The next build will pick them up.

> To consume these inside the static site, generate a small Liquid file (e.g. `_includes/env.html`) that emits a `<script>window.__TKN_ENV = { ... }</script>` block populated from `site.config` or pre-build script. Frontend code (e.g. `web3-bundle-src.js`) can then read `window.__TKN_ENV.VITE_BASE_RPC_URL`.

---

## 5. Enable automatic + preview deployments

Both production and preview deploys are wired automatically by the included workflow:

- **Production:** Every push to `main` rebuilds and ships to `https://tokenomic.org`.
- **Previews:** Every pull request gets a unique preview URL like `https://<sha>.tokenomic.pages.dev`. The workflow also drops the URL as a comment on the PR.
- **Manual:** Trigger a deploy from **Actions → Deploy to Cloudflare Pages → Run workflow**.

You can also enable Cloudflare's built-in Git integration (set up in step 1) — it produces the same previews. Pick **one** of the two to avoid double-deploys:

- **Use only the GitHub Action** (recommended): in the Cloudflare project settings, go to **Builds & deployments** and **disable** the automatic build on push. Cloudflare Pages will still receive deploys via the action.
- **Use only Cloudflare's Git integration**: delete `.github/workflows/cloudflare-pages-deploy.yml`.

---

## 6. Local verification before pushing

```bash
# 1. Install Ruby gems and npm deps
bundle install
npm install

# 2. Build the Web3 bundle (viem)
npm run build:web3

# 3. Build the static site
bundle exec jekyll build

# 4. Preview locally
npx serve _site
```

If `_site/index.html` exists and the page loads at `http://localhost:3000`, you are good to push.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `bundler: command not found: jekyll` | Run `bundle install` to install gems from `Gemfile.lock`. |
| Build fails with `Could not locate Gemfile` | Confirm the Pages **Root directory** is blank (defaults to repo root). |
| Ruby version mismatch | The workflow pins `ruby-3.2`. To use a different version, update `RUBY_VERSION` in `cloudflare-pages-deploy.yml` and add a `.ruby-version` file. |
| `wrangler-action` exits with `Authentication error` | Re-check that `CLOUDFLARE_API_TOKEN` has `Cloudflare Pages: Edit` permission for the right account. |
| Preview URL not commented on PR | Check the workflow run for the `Comment deployment URL on PR` step — it requires the PR to come from a branch in the same repo (forks have restricted token scopes). |
| Cards on `/courses/` are empty | This is the GitHub API not the deployment. Set `GITHUB_TOKEN` in the *server* environment (or add a Pages env var if the API moves to Workers). |
| Custom domain stays in **Verifying** | Wait up to 24h for DNS propagation. If still stuck, delete and re-add the domain. |

---

## 8. File reference

| File | Role |
| --- | --- |
| `.github/workflows/cloudflare-pages-deploy.yml` | CI/CD pipeline: build Jekyll + deploy to Pages |
| `.github/workflows/jekyll.yml` | Legacy GitHub Pages workflow — kept as backup, can be disabled in **Settings → Pages** |
| `wrangler.jsonc` | Legacy Workers Static Assets config — only needed if you also deploy to Workers |
| `_site/` | Generated Jekyll output (gitignored except for tracked initial snapshot) |
| `shared/assets/js/web3-bundle.js` | esbuild output of `web3-bundle-src.js` (viem) |

---

That's everything. Push to `main` and watch your first Cloudflare Pages deployment go green.
