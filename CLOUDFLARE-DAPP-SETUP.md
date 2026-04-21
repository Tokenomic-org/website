# Tokenomic — Cloudflare DApp Setup

A pragmatic map of where each piece of Tokenomic lives now that the stack
is fully on Cloudflare. **Read this before touching storage code** so you
don't accidentally put video bytes on IPFS or course rows on-chain.

## Account & domains

| Resource              | Value |
|-----------------------|-------|
| Cloudflare account    | `c016…` (env `CLOUDFLARE_ACCOUNT_ID`) |
| Apex domain           | `tokenomic.org` (zone `e66d3695c398f71411abfb74156e0aea`) |
| Site worker           | `tokenomic` → custom domains: `tokenomic.org`, `www.tokenomic.org` |
| API worker            | `tokenomic-api` → `tokenomic-api.guillaumelauzier.workers.dev` |
| D1 database           | `tokenomic-db` (uuid `6c1e01cf…`), bound as `DB` in api-worker |
| KV namespace          | `STREAM_META` (course metadata mirror) |
| Cloudflare Stream     | enabled; `STREAM_CUSTOMER_SUBDOMAIN` env on api-worker |
| R2 bucket             | `tokenomic-assets` (thumbnails / PDFs) — _enabling pending R2 token_ |

## On-chain vs off-chain split

This is the **single rule** the codebase enforces:

| Data                                | On-chain (Base L2) | Off-chain (Cloudflare) | IPFS |
|-------------------------------------|:------------------:|:----------------------:|:----:|
| Course id + price + educator wallet | ✅ `TokenomicMarket.sol` |  |  |
| Course title, description, modules  |  | ✅ D1 `courses` |  |
| Course video (MP4/HLS)              |  | ✅ Cloudflare Stream |  |
| Course thumbnail / PDF              |  | ✅ R2 (`tokenomic-assets`) |  |
| Course metadata JSON (legacy NFT)   |  | ✅ KV `stream-meta:<uid>` |  |
| Community row + member counts       |  | ✅ D1 `communities` |  |
| Community discussions               |  | ✅ D1 `messages` |  |
| Article body + cover image          |  | ✅ D1 `articles` + R2 |  |
| Educator / consultant profile       |  | ✅ D1 `profiles` |  |
| Bookings (consultant calls)         |  | ✅ D1 `bookings` |  |
| Revenue ledger                      | ✅ tx hash | ✅ D1 `revenue_tx` mirror |  |
| Wallet nonce / SIWE login           |  | ✅ in-memory on api-worker |  |
| Purchase receipt (USDC transfer)    | ✅ event log |  |  |
| **Certificate token metadata JSON** | ✅ tokenURI pointer |  | ✅ pinned JSON |
| Certificate image (badge)           |  | ✅ R2 (referenced from IPFS JSON) |  |

**Why IPFS only for certificate metadata?** ERC-721 marketplaces
(OpenSea etc.) expect a stable, content-addressed `tokenURI`. Hosting
that JSON on Cloudflare would mean the badge could "change" if the
worker is reconfigured — IPFS gives us a permanent receipt for ~300 B
per certificate. Everything else stays on Cloudflare because it's
either too big for IPFS (video), too mutable (member counts), or
private (wallet ↔ profile mapping).

## Auth model

* **Reads** — unauthenticated. Anyone can `GET /api/courses`, etc.
* **Writes** — Authorization: `Bearer <jwt>` issued by:
  1. `POST /api/auth/nonce {wallet}` → `{message}` (EIP-191)
  2. wallet signs `message`
  3. `POST /api/auth/login {wallet, signature}` → `{token, exp}` (24 h)
  4. token cached in `localStorage` by `shared/assets/js/d1-client.js`

## D1 schema (high level)

`workers/api-worker/migrations/0001_init.sql` defines 8 tables:

```
profiles      (wallet PK, role, display_name, bio, specialty, approved, …)
communities   (id, slug, name, type, access, educator_wallet, members_count, …)
courses       (id, slug, title, educator_wallet, community_id, price_usdc,
               modules_count, estimated_hours, what_you_learn JSON,
               stream_video_uid, on_chain_course_id, status, …)
articles      (id, slug, title, body_md, cover_url, author_wallet, …)
enrollments   (course_id, wallet, on_chain_tx, completed_at)
bookings      (consultant_wallet, client_wallet, slot_at, status, paid_tx)
revenue_tx    (tx_hash PK, wallet, kind, usdc_amount, course_id, ts)
messages      (id, scope, scope_id, author_wallet, body, ts)
```

## Worker endpoints (read = public, write = Bearer JWT)

```
GET  /api/courses                          ?community_id=&educator=
GET  /api/courses/:idOrSlug
POST /api/courses                          (Bearer)
GET  /api/communities                      ?educator=&category=
GET  /api/communities/:idOrSlug
POST /api/communities                      (Bearer)
GET  /api/communities/:id/discussions
POST /api/communities/:id/discussions      (Bearer)
GET  /api/articles                         ?category=
GET  /api/articles/:slug
POST /api/articles                         (Bearer)
GET  /api/experts                          (educators + consultants)
GET  /api/experts/:wallet
GET  /api/profile/:wallet
POST /api/profile                          (Bearer, upsert)
GET  /api/revenue/:wallet
POST /api/revenue                          (Bearer, record tx hash)
GET  /api/enrollments?wallet=
GET  /api/bookings?wallet=
POST /api/bookings                         (Bearer)
POST /api/auth/nonce
POST /api/auth/login
POST /stream/direct-upload                 (mints CF Stream upload URL)
GET  /stream/:uid
POST /stream/:uid/json-meta
```

## Frontend bridge

`shared/assets/js/d1-client.js` exposes a global `TokenomicSupabase`
(name preserved for legacy callers) and a friendlier `TokenomicAPI`
alias. Both call the endpoints above and **never** fall back to demo
data — empty arrays render the empty-state CTAs instead.

## Deploy commands

```bash
# api-worker (uses wrangler v4 — must pass --config explicitly)
cd workers/api-worker
npx wrangler deploy --config ./wrangler.toml

# site-worker (Jekyll build → assets)
bundle exec jekyll build
cd workers/site-worker
npx wrangler deploy --config ./wrangler.toml
```

`_config.yml` already excludes `workers/`, `contracts/`, `scripts/`,
`tests/`, and `**/node_modules/` so the site-worker bundle stays under
the 25 MiB worker limit.

## Deferred (need user input)

* **R2 thumbnail upload** — requires a new Cloudflare API token with
  R2 permissions; current `CLOUDFLARE_API_TOKEN` is Workers-only.
* **TokenomicMarket address** — set `window.__TKN_ENV.MARKET_CONTRACT`
  once the contract is deployed; until then the "Enroll" button surfaces
  `MARKET_CONTRACT not configured`.
* **Realtime chat** — D1 has no pub/sub. Move `messages` to a Durable
  Object when realtime is needed.
