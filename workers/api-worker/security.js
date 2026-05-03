/**
 * security.js — Phase 7
 *
 * Edge-level security middleware that runs BEFORE any handler logic so
 * banned-country traffic and malformed requests never touch D1, the
 * on-chain RPCs, or the Stream/Images APIs.
 *
 *   1. geoBlockMiddleware()       — country allow/deny via Cloudflare's
 *                                   `cf-ipcountry` header (set by the
 *                                   Cloudflare edge before the Worker
 *                                   runs). Sanctioned-country list is
 *                                   conservative and pulled from OFAC's
 *                                   comprehensive sanctions program.
 *   2. tightSecureHeaders()       — Strict CSP (no inline JS except a
 *                                   single sha256 hash for the dark-mode
 *                                   bootstrap), HSTS, X-Frame-Options,
 *                                   Referrer-Policy, Permissions-Policy.
 *   3. authRateLimitMiddleware()  — Per-IP burst limiter on /api/auth/*,
 *                                   /api/siwe/verify, /api/admin/login.
 *
 * All middleware short-circuit with a clean JSON response so callers see
 * a structured error instead of a CF default page.
 */

import { secureHeaders } from 'hono/secure-headers';

// OFAC comprehensive sanctions (subset — Worker side, dashboard WAF rules
// should mirror this list for defence-in-depth). Use ISO-3166-1 alpha-2.
//
// We intentionally do NOT block from inside the Worker for "moderate" risk
// jurisdictions — those are the WAF's job. This list is for places where
// serving the dApp would violate U.S. / EU sanctions law.
export const SANCTIONED_COUNTRIES = new Set([
  'CU', // Cuba
  'IR', // Iran
  'KP', // North Korea
  'SY', // Syria
  // Crimea / DNR / LNR are sub-national; Cloudflare exposes them via
  // cf.regionCode, not cf-ipcountry. Handled at the WAF layer instead.
]);

// Routes that must always be reachable (health checks, status pages, the
// geo-block page itself). Everything else is gated.
const GEO_ALLOWLIST_PATHS = new Set([
  '/api/health',
  '/__health',
  '/api/geo/status',
]);

export function geoBlockMiddleware() {
  return async function geoBlock(c, next) {
    if (GEO_ALLOWLIST_PATHS.has(c.req.path)) return next();
    const country = (c.req.header('cf-ipcountry') || '').toUpperCase();
    if (country && SANCTIONED_COUNTRIES.has(country)) {
      return c.json(
        {
          error: 'Service unavailable in your region',
          reason: 'geo-block',
          country,
          contact: 'compliance@tokenomic.org',
        },
        451, // Unavailable For Legal Reasons (RFC 7725)
      );
    }
    return next();
  };
}

/**
 * Strict secure-headers config.
 *
 * CSP rationale:
 *  - default-src 'self' so an injected <img>/<script> can't load from
 *    arbitrary origins.
 *  - script-src adds the IPFS / unpkg CDNs we already use for React
 *    + ethers, plus a single sha256 hash for the dark-mode bootstrap
 *    inlined in island-bootstrap.html. No 'unsafe-inline'.
 *  - style-src allows 'unsafe-inline' because the legacy Bootstrap-4
 *    theme inlines style attributes in dozens of templates. Reducing
 *    this is queued for Phase 8 (template rewrite).
 *  - frame-ancestors 'none' blocks click-jacking.
 *  - connect-src enumerates the worker domains + Base RPC + WalletConnect
 *    relay so cookie-bearing fetches can't be redirected to attacker hosts.
 */
export function tightSecureHeaders() {
  return secureHeaders({
    strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: ['self'],
      usb: [],
      fullscreen: ['self'],
    },
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // 'wasm-unsafe-eval' covers viem/ethers' BigInt polyfill; no eval().
      scriptSrc: [
        "'self'",
        "'wasm-unsafe-eval'",
        // Hash for the flash-free dark-mode bootstrap in island-bootstrap.html.
        // Recompute via: shasum -a 256 < snippet.js | xxd -r -p | base64
        "'sha256-Zr4y0bbYsmCNxuPfW3Fz7Pp/kF2OqaiI8RB/5G3YN+I='",
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://imagedelivery.net'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: [
        "'self'",
        'https://*.workers.dev',
        'https://*.tokenomic.org',
        'https://mainnet.base.org',
        'https://sepolia.base.org',
        'https://api.cloudflare.com',
        'https://relay.walletconnect.com',
        'wss://relay.walletconnect.com',
      ],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  });
}

/**
 * Per-IP burst limiter for auth endpoints.
 *
 * Wraps the existing rateLimit() helper from index.js. Defaults are
 * deliberately tight (5/min/IP) on auth surfaces because the cost of a
 * failed login is the only thing protecting break-glass admin wallets.
 *
 * Uses the same RATE_LIMIT_KV namespace already configured in
 * wrangler.toml; falls back to the in-memory bucket like the parent
 * helper, which is acceptable for a single-instance auth burst.
 */
export function authRateLimitMiddleware(rateLimit, clientIp, opts = {}) {
  const limit = opts.limit ?? 5;
  const windowSec = opts.windowSec ?? 60;
  const matchers = [
    /^\/api\/auth\//,
    /^\/api\/siwe\/verify$/,
    /^\/admin\/login$/,
  ];
  return async function authRateLimit(c, next) {
    if (!matchers.some((rx) => rx.test(c.req.path))) return next();
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    const ip = clientIp(c);
    const rl = await rateLimit(c, `${ip}:auth`, limit, windowSec);
    c.header('X-RateLimit-Limit', String(rl.limit));
    c.header('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.ok) {
      return c.json(
        { error: 'Too many auth attempts. Try again in a minute.' },
        429,
      );
    }
    return next();
  };
}
