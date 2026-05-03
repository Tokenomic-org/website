# Security Policy

## Reporting a vulnerability

**Please don't open public GitHub issues for security reports.**

Email **`security@tokenomic.org`** with:

1. A short description of the issue and its impact.
2. Reproduction steps (URLs, payloads, screenshots).
3. Your name / handle for credit (optional).

You'll get an acknowledgement within **2 business days** and a triage
update within **5 business days**. We aim to ship a fix or mitigation
within 30 days for high-severity issues; chain-level issues affecting
deployed contracts are handled out-of-band — see "Smart contracts"
below.

## Scope

| In scope | Out of scope |
|---|---|
| `tokenomic.org` and `*.tokenomic.org` | Third-party services we link to (Cloudflare, GitHub, Helio, etc.) |
| `*.workers.dev` Workers we operate | Any DoS via raw traffic volume (the WAF handles it) |
| The Phase 1 smart contracts deployed to Base mainnet (see `deployments/base.json`) | Test deploys on Base Sepolia |
| All code in this repository | Self-XSS where the attacker is the only victim |
| OAuth integrations (Google, Microsoft, Calendly) | Social engineering of staff / users |

## Bug-bounty terms

We don't run a paid bounty programme yet. We do offer:

- Public credit in `SECURITY.md` and the relevant fix commit (with your
  consent).
- A signed thank-you NFT minted from `CertificateNFT` on Base (gas paid
  by us).
- For critical findings on the smart-contract suite, a discretionary
  reward in USDC on Base.

Findings that demonstrate a working exploit chain on production
infrastructure get priority.

## Smart contracts

The Phase 1 contract suite (`RoleRegistry`, `ReferralRegistry`,
`SplitsManager`, `CourseAccess1155`, `CertificateNFT`,
`SubscriptionManager`) is governed by a multisig at
`treasury.tokenomic.eth`. To report a contract-level issue:

1. Email `security@tokenomic.org` with `[CONTRACT]` in the subject.
2. **Do not** publish PoCs to mainnet. Use Base Sepolia for any
   demonstration.
3. We will coordinate a pause via the `RoleRegistry` admin role and a
   migration plan for affected funds.

## Things we already do (so you don't waste time reporting them)

- HSTS with `preload`; HTTP→HTTPS redirect at the edge.
- CSP with no `unsafe-inline` script and only one hashed inline
  bootstrap (dark-mode preload).
- `frame-ancestors 'none'`; the dApp can't be embedded.
- `SameSite=None; Secure; HttpOnly` cookies for the SIWE session, gated
  by an explicit Origin allowlist (no wildcard CORS reflection).
- Per-IP rate limits on all auth endpoints + Turnstile on signup +
  invite flows.
- Geo-blocks on OFAC-sanctioned jurisdictions (CU, IR, KP, SY) at the
  Worker edge.
- All secrets stored as Cloudflare Worker secrets — none committed to
  the repo. Inventory in `workers/api-worker/SECRETS.md`.
- DOMPurify on every user-rendered HTML surface (articles, comments,
  bios). See `shared/assets/js/dom-purify-loader.js`.

## Hall of fame

(Empty — be the first.)
