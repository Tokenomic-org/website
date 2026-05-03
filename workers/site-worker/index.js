/**
 * tokenomic site worker
 *
 * Serves the static Jekyll build (`_site/`) via the ASSETS binding while
 * also exposing a small runtime config endpoint backed by the Worker's
 * env vars + secrets — the reason this Worker has a script at all
 * (Cloudflare disallows variables on static-assets-only Workers).
 *
 *   GET /__health    -> { ok, ts }
 *   GET /__config    -> public env (safe subset, no secrets)
 *   *                -> static asset (assets binding)
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/__health') {
      return Response.json({ ok: true, ts: Date.now(), worker: 'tokenomic' });
    }

    if (url.pathname === '/__config') {
      // Whitelist only safe public values. Never echo secrets.
      const cfg = {
        BASE_CHAIN_ID:             env.BASE_CHAIN_ID || '8453',
        BASE_RPC_URL:              env.BASE_RPC_URL || 'https://mainnet.base.org',
        USDC_CONTRACT:             env.USDC_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        MARKET_CONTRACT:           env.MARKET_CONTRACT || '',
        CERTIFICATE_CONTRACT:      env.CERTIFICATE_CONTRACT || '',
        ETH_GATEWAY_URL:           env.ETH_GATEWAY_URL || '',
        BASESCAN_BASE:             env.BASESCAN_BASE || 'https://basescan.org',
        API_BASE:                  env.API_BASE || '',
        WEB3_BASE:                 env.WEB3_BASE || '',
        STREAM_CUSTOMER_SUBDOMAIN: env.STREAM_CUSTOMER_SUBDOMAIN || ''
      };
      return Response.json(cfg, {
        headers: { 'cache-control': 'public, max-age=60' }
      });
    }

    // Fall through to static assets.
    const resp = await env.ASSETS.fetch(request);
    return withSecurityHeaders(resp, url, env);
  }
};

// Phase 7 — strict-by-default security headers on every static response.
//
// Two CSP headers are emitted:
//   1. Content-Security-Policy            — STRICT, enforced. Permits
//      'self' for scripts (no unsafe-inline, no unsafe-eval) plus the
//      one hashed inline bootstrap from _includes/island-bootstrap.html
//      and the cdnjs origin we use for DOMPurify (SRI-pinned). Allows
//      'unsafe-inline' on STYLE only because the legacy Bootstrap-4
//      theme inlines style attributes everywhere; that's a stylesheet
//      surface, not a JS execution surface, so the XSS reach is small.
//   2. Content-Security-Policy-Report-Only — SUPER-STRICT. Same script
//      restrictions, also disallows inline styles. We collect violation
//      reports during the legacy-template rewrite phase and promote
//      this to enforced once it stops firing.
//
// Reports go to the configured CSP_REPORT_URL if set; otherwise the
// header is omitted (a CSP without report-uri is just noise).
const STRICT_SCRIPT_SRC =
  "'self' " +
  // Hash for the dark-mode bootstrap inlined in island-bootstrap.html.
  "'sha256-Zr4y0bbYsmCNxuPfW3Fz7Pp/kF2OqaiI8RB/5G3YN+I=' " +
  // DOMPurify (SRI-pinned in dom-purify-loader.js).
  "https://cdnjs.cloudflare.com";

const STRICT_CSP =
  "default-src 'self'; " +
  "script-src "  + STRICT_SCRIPT_SRC + "; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https://*.tokenomic.org https://*.workers.dev https://mainnet.base.org https://sepolia.base.org https://api.cloudflare.com https://relay.walletconnect.com wss://relay.walletconnect.com; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "upgrade-insecure-requests";

const REPORT_ONLY_CSP =
  "default-src 'self'; " +
  "script-src "  + STRICT_SCRIPT_SRC + "; " +
  "style-src 'self'; " +     // tighter than enforced — gathers data
  "img-src 'self' data: blob: https:; " +
  "font-src 'self' data:; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'";

// Legacy CSP for path-prefixes that still ship Alpine-style inline
// `<script>` blocks (the older /dashboard/{bookings,chat,communities,
// events,index,leaderboard,revenue,social,referrals,profile} hub
// pages). These predate the Phase 7 island rewrite and have not yet
// been audited for inline-script extraction. We allow 'unsafe-inline'
// on script-src here ONLY — 'unsafe-eval' is still forbidden, and the
// super-strict Report-Only header is still emitted so we can drive
// the eventual extraction pass with real violation data.
const LEGACY_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; " +
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https:; " +
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
  "connect-src 'self' https: wss:; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "upgrade-insecure-requests";

// Path prefixes that have NOT been audited for inline scripts and still
// receive the legacy CSP. Everything else gets STRICT_CSP. Add to this
// list with caution and remove entries as pages are extracted.
const LEGACY_CSP_PREFIXES = [
  '/dashboard/bookings',
  '/dashboard/chat',
  '/dashboard/communities',
  '/dashboard/events',
  '/dashboard/leaderboard',
  '/dashboard/revenue',
  '/dashboard/social',
  '/dashboard/referrals',
  '/dashboard/profile',
  '/dashboard/articles',
  '/dashboard/courses',
];
function isLegacyPath(pathname) {
  if (pathname === '/dashboard' || pathname === '/dashboard/') return true;
  for (const p of LEGACY_CSP_PREFIXES) {
    if (pathname === p || pathname === p + '/' || pathname.startsWith(p + '/')) return true;
  }
  return false;
}

function withSecurityHeaders(resp, url, env) {
  const h = new Headers(resp.headers);
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), interest-cohort=()'
  );
  if (!h.has('Content-Security-Policy')) {
    const pathname = (url && url.pathname) || '';
    h.set(
      'Content-Security-Policy',
      isLegacyPath(pathname) ? LEGACY_CSP : STRICT_CSP,
    );
  }
  if (env && env.CSP_REPORT_URL) {
    // Report-Only stays at full strictness EVERYWHERE so the legacy
    // pages keep generating violation reports to drive extraction.
    h.set(
      'Content-Security-Policy-Report-Only',
      REPORT_ONLY_CSP + '; report-uri ' + env.CSP_REPORT_URL,
    );
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}
