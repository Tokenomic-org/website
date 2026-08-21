# Tokenomic — System Architecture

Last updated: 2026-08-17.

## One-page diagram

```
                          ┌─────────────────────────────────┐
                          │           tokenomic.org          │
                          │         (Cloudflare DNS)         │
                          └────────────────┬────────────────┘
                                           │
                          ┌────────────────▼────────────────┐
                          │  Cloudflare WAF + Bot Mgmt + DDoS│
                          └────────────────┬────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
   ┌──────────▼──────────┐    ┌────────────▼────────────┐   ┌──────────▼──────────┐
   │  workers/site-worker │    │  workers/api-worker     │   │  workers/web3-worker│
   │  (static Jekyll +    │    │  (Hono — D1, KV, R2,    │   │  (read-only RPC     │
   │   /__config endpoint)│    │   Stream, Images, OAuth,│   │   proxy: Base L2)   │
   └──────────┬──────────┘    │   SIWE, admin, paywall) │   └──────────┬──────────┘
              │               └─────┬───────────┬───────┘              │
              │                     │           │                      │
              │  ┌──────────────────▼─┐ ┌───────▼────────┐ ┌───────────▼─────────┐
              │  │ Cloudflare D1       │ │ Cloudflare KV  │ │ Base L2 RPC         │
              │  │ (30 tables: profiles│ │ (comments,     │ │ (mainnet.base.org)  │
              │  │  courses, articles, │ │  rate limits,  │ └─────────────────────┘
              │  │  bookings, …)       │ │  stream meta)  │
              │  └─────────────────────┘ └────────────────┘
              │
              │  ┌─────────────────────┐ ┌────────────────┐ ┌─────────────────────┐
              │  │ Cloudflare Stream   │ │ Cloudflare R2  │ │ Cloudflare Images   │
              │  │ (course videos,     │ │ (avatars, PDFs,│ │ (thumbnails, covers)│
              │  │  signed playback)   │ │  certificate   │ └─────────────────────┘
              │  └─────────────────────┘ │  artifacts)    │
              │                          └────────────────┘
              │
              │  ┌─────────────────────┐ ┌────────────────┐
              │  │ Cloudflare Queues   │ │ Durable Objects│
              │  │ (tkn-invites)       │ │ (ChatRoom)     │
              │  └─────────────────────┘ └────────────────┘
              │
              │  ┌─────────────────────┐ ┌────────────────┐
              │  │ Workers Analytics   │ │ MailChannels   │
              │  │ Engine (per-route   │ │ (DKIM-signed   │
              │  │  latency / errors)  │ │  transactional)│
              │  └─────────────────────┘ └────────────────┘
              │
   ┌──────────▼──────────┐
   │  Browser (islands)  │  React 18 IIFE bundles, Tailwind tokens,
   │                     │  dark-mode default, viem v2, WalletConnect.
   └─────────────────────┘
```

## On-chain ↔ off-chain split (single source of truth)

| Data                            | On-chain (Base L2)        | Off-chain (Cloudflare) | IPFS |
|---------------------------------|---------------------------|------------------------|------|
| Course access NFT balance       | `CourseAccess1155`        |                        |      |
| Course catalogue + descriptions |                           | D1 `courses`           |      |
| Course video                    |                           | Stream                 |      |
| Course thumbnail / article cover|                           | R2 + Images            |      |
| Subscription state              | `SubscriptionManager`     |                        |      |
| Revenue split executions        | `SplitsManager` (0xSplits)|                        |      |
| Certificate token (soulbound)   | `CertificateNFT`          |                        | metadata |
| Roles / admin set               | `RoleRegistry`            | mirror in D1 audit_log |      |
| Referral attribution            | `ReferralRegistry`        | mirror in D1 referrals |      |
| User profile                    |                           | D1 `profiles`          |      |
| Comments                        |                           | KV                     |      |
| Calendar OAuth refresh tokens   |                           | D1 (AES-GCM encrypted) |      |
| Real-time chat                  |                           | Durable Objects        |      |

## Worker boundaries

- **`tokenomic` (site-worker)** — serves `_site/` via the ASSETS binding;
  exposes `/__config` (public env subset) and `/__health`. No secrets.
- **`tokenomic-api` (api-worker)** — every business route, gated by
  SIWE + `RoleRegistry`. Holds all secrets (Stream, Images, OAuth, R2
  signing, Mail DKIM). Edge middleware order, top to bottom:
  1. `geoBlockMiddleware()` — OFAC sanctions check on `cf-ipcountry`.
  2. `tightSecureHeaders()` — CSP / HSTS / Permissions-Policy.
  3. `analyticsMiddleware()` — writes a row to Workers Analytics Engine
     for every request (route, status, latency, country, role).
  4. CSRF Origin/Referer guard for mutating methods.
  5. CORS with credentials + dynamic origin echo.
  6. `authRateLimitMiddleware()` — 5/min/IP on `/api/auth/*` and `/api/siwe/verify`.
  7. Route handlers.
- **`tokenomic-web3` (web3-worker)** — read-only RPC proxy. No D1, no
  secrets, no auth.

## Phase progression (where things came from)

| Phase | Theme | Notable additions |
|-------|-------|-------------------|
| 0 | SIWE + cookie sessions | `siwe.js`, HMAC-signed `tk_session` cookie |
| 1 | Smart-contract suite | 6 contracts, unit-tested under Hardhat (**not yet deployed** — see below) |
| 2 | React islands + design system | `apps/web/src/islands/*`, `packages/ui` |
| 3a | Admin console | `admin-routes.js`, audit log, role registry reader |
| 3b | Creator workbenches | educator + consultant dashboards |
| 3c | Learner home | `/dashboard/` aggregate view |
| 4 | Calendar OAuth | Google / Microsoft / Calendly with AES-GCM tokens |
| 5 | Referrals + invites | Turnstile, MailChannels DKIM, Cloudflare Queues |
| 6 | Content infra | signed Stream playback, R2 PDFs, CF Images |
| 7 | Polish & launch | i18n (EN/TR/ES), CSP/HSTS, geo-block, AE observability, docs |

## D1 schema (where the table count comes from)

Migrations live in `workers/api-worker/migrations/*.sql` and are the source of
truth for the diagram's table count. Regenerate it with:

```sh
grep -rhoiE 'CREATE TABLE +(IF NOT EXISTS +)?[a-zA-Z0-9_]+' \
  workers/api-worker/migrations/*.sql | awk '{print tolower($NF)}' | sort -u | wc -l
```

As of this update: **9 migration files, 31 `CREATE TABLE` statements, 30
distinct tables** — `audit_log` is declared twice (`0002_roles_and_approval.sql`
and `0007_audit_log_phase3a.sql`), both guarded by `IF NOT EXISTS`, so the
later definition is a no-op against an already-migrated database.

Two migrations also share the `0008` prefix (`0008_creator_workbenches.sql` and
`0008_phase5_referrals_invites.sql`). They touch disjoint tables so ordering
between them does not currently matter, but the numbering is ambiguous and the
next migration should not reuse a prefix.

## Smart contracts — built vs. deployed

The Phase 1 suite (`RoleRegistry`, `ReferralRegistry`, `SplitsManager`,
`CourseAccess1155`, `CertificateNFT`, `SubscriptionManager`) exists under
`contracts/` and is unit-tested under `test/*.test.js`, but **it is not
deployed to any network**: there is no `deployments/` directory, and no
addresses are configured in `.env.example` or any `wrangler.toml`.

The live purchase path in `shared/assets/js/web3-assets.js` still runs on the
legacy `TokenomicMarket` / `TokenomicCertificate` pair that the Phase 1 suite
was written to replace. Treat the on-chain rows in the table above as the
*intended* split, not the shipped one, until that migration lands.

## Local-dev shim

`server.js` runs only on Replit. It serves `_site/` via Express,
proxies `/api/*` to a local Postgres for the admin console, and signs
SIWE messages with `ethers v6`. **Production never touches it.** The
shim reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DATABASE_URL`, and
`GITHUB_PERSONAL_ACCESS_TOKEN` from Replit Secrets.

## Where to look first

- New API endpoint? `workers/api-worker/d1-routes.js` or its phase-
  specific sibling (`educator-routes.js`, `consultant-routes.js`,
  `oauth-calendar.js`, `referrals.js`, `content-infra.js`,
  `admin-routes.js`).
- New island? `apps/web/src/islands/` and register in
  `scripts/build-islands.mjs`.
- New secret? `workers/api-worker/SECRETS.md` (single source of truth).
- New page? Source HTML at the page root + `_site/` mirror; rebuild via
  `node scripts/rebuild-dashboard-site.js`.
