# Cloudflare edge infrastructure (Phase 7 follow-up)

This directory codifies the **dashboard-managed** Cloudflare configuration that
sits *in front of* the Workers in `workers/`:

| File                          | Purpose                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `waf-rules.json`              | WAF custom rules: scraper UA block, per-ASN rate limit on `/api/siwe/verify`, sub-national OFAC geo-block. |
| `email-routing-rules.json`    | Email Routing rule that forwards `alerts@tokenomic.org` (the From address used by `workers/api-worker/alerts.js`) to `OPS_ALERT_EMAIL`. |
| `apply.sh`                    | Idempotent applier — POSTs the JSON files to the Cloudflare REST API.                          |
| `csp-rollout.md`              | Rollout plan for the tightened site-worker CSP (Report-Only first, then enforced).             |

## Why this lives outside the Worker code

WAF custom rules, Rate-Limiting rules and Email Routing rules are **zone-level
configuration** in Cloudflare. They are evaluated *before* a request reaches the
Worker (or for inbound email, replace the Worker entirely), so they cannot be
expressed in `wrangler.toml`. Keeping the JSON in-tree means:

1. The rules are reviewed alongside code changes.
2. We can re-apply them after a recovery / new account by running `apply.sh`.
3. Drift between dashboard state and source of truth is detectable
   (`apply.sh --diff`).

## Required environment

`apply.sh` reads:

```
CF_API_TOKEN     # Account-scoped token: Zone WAF: Edit, Zone Rate Limiting: Edit,
                 # Email Routing: Edit
CF_ACCOUNT_ID    # Cloudflare account id (same as workers/api-worker)
CF_ZONE_ID       # Zone id for tokenomic.org
OPS_ALERT_EMAIL  # Destination for forwarded alert mail (must be a verified
                 # destination address in the Cloudflare Email Routing dashboard
                 # before this script will succeed)
```

Run from the repo root:

```bash
CF_API_TOKEN=… CF_ACCOUNT_ID=… CF_ZONE_ID=… OPS_ALERT_EMAIL=ops@tokenomic.org \
  bash infra/cloudflare/apply.sh
```

`apply.sh` is idempotent: it lists existing rules, deletes ones whose `description`
matches a managed prefix (`tkn-managed:`), and re-creates them from JSON. This
keeps the JSON the single source of truth.

## OFAC sub-national zones

The Worker's `SANCTIONED_COUNTRIES` set in `workers/api-worker/security.js`
covers the country-level OFAC list (CU/IR/KP/SY) using `cf-ipcountry`.
Cloudflare exposes sub-national regions (Crimea, DNR, LNR) only via
`cf.regionCode`, which is **not** available inside a request header — it only
exists on the WAF firewall expression evaluator. That is why those blocks must
live here instead of in `security.js`.

## Email Routing — analytics-engine alerts

`workers/api-worker/alerts.js` sends MailChannels mail with `From:
alerts@tokenomic.org`. The Email Routing rule below is the *inbound* side: any
mail arriving at `alerts@tokenomic.org` (e.g. bounces, replies, or alerts from
external monitors) is forwarded to `OPS_ALERT_EMAIL`. The forward is necessary
because `alerts@` has no mailbox of its own — without a routing rule the
Cloudflare default catch-all rejects the message and we lose bounce telemetry.
