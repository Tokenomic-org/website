# Tokenomic — Secrets Inventory & Rotation Runbook

> **Audit date:** 2026-05-03
> **Scope:** every hardcoded credential, API key, OAuth client secret,
> webhook signing secret and HMAC key referenced by the codebase.
>
> **Source of truth at runtime:** Cloudflare Worker secrets (set via
> `wrangler secret put`). Local development reads the same names from
> Replit Secrets / `.env` (gitignored).

---

## 1. Audit summary

### Hardcoded values that were committed (now removed)

| File | Value | Severity | Action taken |
|---|---|---|---|
| `server.js:10` | `ADMIN_EMAIL = 'guillaumelauzier@gmail.com'` | **Medium** — PII + auth gate. Anyone reading the repo learned the only address that can log into the Express admin console. | Replaced with `process.env.ADMIN_EMAIL`. **Rotate `ADMIN_PASSWORD` now** since the matching email was public. |
| `wrangler.example.toml:37` | `CF_ACCOUNT_ID = "c016d64a9a4f4a2900fb3385bd08144f"` | **Low/Medium** — Cloudflare account IDs are not classified as secret by Cloudflare, but committing them enables targeted abuse and account enumeration. | Removed from the example file. Now documented as a `wrangler secret put` value. **Consider rotating** any API tokens that were scoped to that account ID, since the pair (account ID + leaked token) is exploitable. |

### Already correctly externalised (no action needed)

All of these read from `process.env.*` (Node) or `c.env.*` (Worker) — no
literal values in the tree:

* `hardhat.config.js` — `PRIVATE_KEY`, `BASESCAN_API_KEY`, `BASE_RPC_URL`
* `server.js` — `ADMIN_PASSWORD`, `DATABASE_URL`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `PORT`
* `workers/api-worker/*.js` — every secret listed in §3 below is read via `c.env.X`
* `workers/web3-worker/*.js` — pure on-chain proxy, no auth secrets
* `shared/assets/js/web3-bundle-src.js` — `WC_PROJECT_ID` injected from `process.env` at Vite build time
* `_includes/env.html` — only emits Jekyll `site.web3.*` config (public values: contract addresses, RPC URLs, Turnstile **site** key)

### Public-by-design (intentionally embedded in frontend)

These are **not secrets** — they are designed to be public:

* `TURNSTILE_SITE_KEY` — Cloudflare Turnstile **site** key (paired with the secret `TURNSTILE_SECRET_KEY` on the worker side)
* `WC_PROJECT_ID` — WalletConnect Cloud project id (public identifier; gating happens via WalletConnect's allowlist)
* `API_BASE`, `WEB3_BASE` URLs — public Worker hostnames
* USDC / contract addresses on Base — on-chain, public by definition

### `.gitignore` confirms `.env`, `cache/`, `artifacts/`, `coverage/` are excluded

GitHub Actions (`.github/workflows/jekyll.yml`) holds **no secrets** — it only
runs `actions/jekyll-build-pages` and `actions/deploy-pages` which use the
default `GITHUB_TOKEN` from the GitHub OIDC pipeline.

---

## 2. Required Worker secret names

| Secret | Worker | Purpose | Required? |
|---|---|---|---|
| `JWT_SECRET` | `tokenomic-api` | HS256 signing key for legacy `/api/auth/login` JWTs and (fallback) SIWE cookies. | **Yes** |
| `SIWE_SECRET` | `tokenomic-api` | Dedicated HMAC key for SIWE session cookies. Falls back to `JWT_SECRET` if unset. | Recommended |
| `CF_ACCOUNT_ID` | `tokenomic-api` | Cloudflare account id used by Stream + Images APIs. | Yes (Phase 6) |
| `CF_API_TOKEN` | `tokenomic-api` | Combined `Stream:Edit` + `Images:Edit` API token. Use this OR the two per-product tokens below. | Yes |
| `CF_STREAM_TOKEN` | `tokenomic-api` | `Stream:Edit` API token (alternative to `CF_API_TOKEN`). | Optional |
| `CF_IMAGES_TOKEN` | `tokenomic-api` | `Images:Edit` API token (alternative to `CF_API_TOKEN`). | Optional |
| `STREAM_WEBHOOK_SIGNING_SECRET` | `tokenomic-api` | HMAC secret published by CF Stream when registering the webhook URL. Verifies `Webhook-Signature` on `/api/content/stream/webhook`. **Mandatory** in production — the route refuses unsigned bodies. | **Yes** |
| `R2_URL_SIGNING_KEY` | `tokenomic-api` | ≥32-byte secret for HMAC-signing short-lived R2 GET URLs. Falls back to `SIWE_SECRET` / `JWT_SECRET`. | Recommended |
| `OAUTH_TOKEN_ENC_KEY` | `tokenomic-api` | base64url-encoded 32 bytes — AES-GCM key used to encrypt OAuth refresh tokens at rest in D1. | **Yes** (Phase 4) |
| `GOOGLE_OAUTH_CLIENT_ID` | `tokenomic-api` | Google Cloud OAuth client id. | If Google Calendar enabled |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `tokenomic-api` | Google Cloud OAuth client secret. | If Google Calendar enabled |
| `MS_OAUTH_CLIENT_ID` | `tokenomic-api` | Azure AD app (client) id. | If Microsoft 365 enabled |
| `MS_OAUTH_CLIENT_SECRET` | `tokenomic-api` | Azure AD client secret. | If Microsoft 365 enabled |
| `MS_OAUTH_TENANT` | `tokenomic-api` | Azure AD tenant or `common`. | If Microsoft 365 enabled |
| `CALENDLY_OAUTH_CLIENT_ID` | `tokenomic-api` | Calendly OAuth app client id. | If Calendly enabled |
| `CALENDLY_OAUTH_CLIENT_SECRET` | `tokenomic-api` | Calendly OAuth app client secret. | If Calendly enabled |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | `tokenomic-api` | HMAC key for verifying Calendly webhook deliveries. | If Calendly enabled |
| `TURNSTILE_SECRET_KEY` | `tokenomic-api` | Turnstile siteverify secret (site key is public). | If Turnstile enabled |
| `INVITE_HMAC_KEY` | `tokenomic-api` | ≥32-byte secret used to HMAC-sign one-time invite tokens. | **Yes** (Phase 5) |
| `MAILCHANNELS_DKIM_PRIVATE_KEY` | `tokenomic-api` | base64 PKCS#8 RSA key for MailChannels DKIM. (`MAIL_DKIM_PRIVATE_KEY` accepted as legacy fallback.) | **Yes** (Phase 5/6) |
| `MAILCHANNELS_DKIM_SELECTOR` | `tokenomic-api` | DKIM selector (default `mailchannels`). Plain var, but stored as a secret to keep the DKIM bundle co-located. | Recommended |
| `MAILCHANNELS_DKIM_DOMAIN` | `tokenomic-api` | DKIM signing domain (defaults to `MAIL_FROM_DOMAIN`). | Recommended |

`tokenomic-web3` and `tokenomic` (site Worker) require **no secrets** — both
serve public, read-only data.

---

## 3. `wrangler secret put` commands

Run from the repo root. `--env` flags assume you keep production and staging
as separate Wrangler environments under each Worker's `wrangler.toml`.

### Production (`tokenomic-api`)

```bash
cd workers/api-worker

# --- core auth ---
wrangler secret put JWT_SECRET
wrangler secret put SIWE_SECRET

# --- Cloudflare Stream + Images (Phase 6) ---
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN              # OR the two below:
# wrangler secret put CF_STREAM_TOKEN
# wrangler secret put CF_IMAGES_TOKEN
wrangler secret put STREAM_WEBHOOK_SIGNING_SECRET
wrangler secret put R2_URL_SIGNING_KEY

# --- Calendar OAuth (Phase 4) ---
wrangler secret put OAUTH_TOKEN_ENC_KEY
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put MS_OAUTH_CLIENT_ID
wrangler secret put MS_OAUTH_CLIENT_SECRET
wrangler secret put MS_OAUTH_TENANT
wrangler secret put CALENDLY_OAUTH_CLIENT_ID
wrangler secret put CALENDLY_OAUTH_CLIENT_SECRET
wrangler secret put CALENDLY_WEBHOOK_SIGNING_KEY

# --- Referrals & invites (Phase 5) ---
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put INVITE_HMAC_KEY

# --- MailChannels DKIM ---
wrangler secret put MAILCHANNELS_DKIM_PRIVATE_KEY
wrangler secret put MAILCHANNELS_DKIM_SELECTOR
wrangler secret put MAILCHANNELS_DKIM_DOMAIN
```

### Staging (`tokenomic-api-staging`)

Same list, with `--env staging` appended (configure
`[env.staging]` in `wrangler.toml` first):

```bash
cd workers/api-worker

wrangler secret put JWT_SECRET --env staging
wrangler secret put SIWE_SECRET --env staging
wrangler secret put CF_ACCOUNT_ID --env staging
wrangler secret put CF_API_TOKEN --env staging
wrangler secret put STREAM_WEBHOOK_SIGNING_SECRET --env staging
wrangler secret put R2_URL_SIGNING_KEY --env staging
wrangler secret put OAUTH_TOKEN_ENC_KEY --env staging
wrangler secret put GOOGLE_OAUTH_CLIENT_ID --env staging
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env staging
wrangler secret put MS_OAUTH_CLIENT_ID --env staging
wrangler secret put MS_OAUTH_CLIENT_SECRET --env staging
wrangler secret put MS_OAUTH_TENANT --env staging
wrangler secret put CALENDLY_OAUTH_CLIENT_ID --env staging
wrangler secret put CALENDLY_OAUTH_CLIENT_SECRET --env staging
wrangler secret put CALENDLY_WEBHOOK_SIGNING_KEY --env staging
wrangler secret put TURNSTILE_SECRET_KEY --env staging
wrangler secret put INVITE_HMAC_KEY --env staging
wrangler secret put MAILCHANNELS_DKIM_PRIVATE_KEY --env staging
wrangler secret put MAILCHANNELS_DKIM_SELECTOR --env staging
wrangler secret put MAILCHANNELS_DKIM_DOMAIN --env staging
```

### Verify

```bash
wrangler secret list                 # production
wrangler secret list --env staging   # staging
```

---

## 4. Rotation checklist (do this once)

Because the items below were either committed to the repo or paired with
committed identifiers, treat them as compromised and rotate:

1. **`ADMIN_PASSWORD`** for the Express dashboard. The matching admin
   email was public, so any leaked/guessed password could grant access.
2. **Any Cloudflare API tokens scoped to account `c016d64a9a4f...`** —
   regenerate `CF_API_TOKEN` / `CF_STREAM_TOKEN` / `CF_IMAGES_TOKEN` in
   the Cloudflare dashboard → My Profile → API Tokens.
3. After rotation, re-run the relevant `wrangler secret put` commands
   above and `wrangler deploy`.

Nothing else in the audit was found embedded in source, build artifacts,
test fixtures, GitHub Actions workflow files, or frontend bundles.
