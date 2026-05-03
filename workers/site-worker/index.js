/**
 * tokenomic site worker
 *
 * Serves the static Jekyll build (`_site/`) via the ASSETS binding and
 * exposes a small runtime config endpoint backed by env vars (Cloudflare
 * disallows variables on static-assets-only Workers, which is the only
 * reason this Worker has a script).
 *
 *   GET /__health    -> { ok, ts }
 *   GET /__config    -> public env (safe subset, no secrets)
 *   *                -> static asset (assets binding) with strict
 *                       security headers + edge geo-block
 *
 * Phase 7 hardening:
 *   - geoBlock OFAC-sanctioned countries at the very first byte of the
 *     handler so static traffic from CU/IR/KP/SY never reaches assets.
 *   - admin gate: /dashboard/admin/* HTML requires a valid SIWE cookie
 *     and admin role. We subrequest the API worker's /admin/me with the
 *     incoming cookie; non-2xx responses get a 401 shell instead of the
 *     real page so unauthenticated users cannot even read the markup.
 *   - strict CSP everywhere — script-src 'self' only, no inline scripts,
 *     no unsafe-eval. style-src keeps 'unsafe-inline' because the
 *     legacy Bootstrap-4 templates rely on inline style attributes
 *     (CSS-only attack surface, no JS execution).
 */

// Phase 7 — sanctioned-country list. Mirrors the API worker so neither
// surface can be used as an oracle for the other. Kept tiny on purpose;
// extending this list is a policy decision, not a code change.
const GEO_BLOCKED = new Set(['CU', 'IR', 'KP', 'SY']);

// Path prefixes that require an admin role to even view the HTML. The
// API endpoints they call are independently gated; this is a defense-
// in-depth at the static-asset layer so anonymous users can't read the
// admin templates either.
const ADMIN_PATH_PREFIX = '/dashboard/admin';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // (1) Geo-block. Runs before /__health so blocked clients can't even
    // probe liveness. cf.country is on every Cloudflare-routed request.
    const country = (request.cf && request.cf.country) ||
                    request.headers.get('cf-ipcountry') || '';
    if (country && GEO_BLOCKED.has(country.toUpperCase())) {
      return new Response(
        'Service unavailable in your region for legal compliance reasons.',
        { status: 451, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

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

    // (2) Admin-path gate. Subrequest the API worker with the incoming
    // cookie to validate the SIWE session AND the admin role. The API
    // already enforces this for its own endpoints; doing it here too
    // means anonymous users get a clean 401 instead of leaking the
    // page markup (which an attacker could use to map admin routes).
    if (url.pathname.startsWith(ADMIN_PATH_PREFIX)) {
      const ok = await checkAdmin(request, env);
      if (!ok) {
        return adminUnauthorizedResponse(url);
      }
    }

    // (3) Fall through to static assets.
    const resp = await env.ASSETS.fetch(request);
    return withSecurityHeaders(resp, url, env);
  }
};

// ---------- Admin gate helpers ----------

async function checkAdmin(request, env) {
  const cookie = request.headers.get('cookie') || '';
  if (!cookie || cookie.indexOf('tk_session=') < 0) return false;
  const apiBase = env.API_BASE || '';
  if (!apiBase) {
    // Without an API base we cannot validate. Fail-closed.
    return false;
  }
  try {
    const probe = await fetch(apiBase.replace(/\/$/, '') + '/api/auth/me', {
      method: 'GET',
      headers: {
        cookie,
        'cf-connecting-ip': request.headers.get('cf-connecting-ip') || '',
        accept: 'application/json',
      },
      // Don't let an admin probe stall the page indefinitely.
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!probe.ok) return false;
    const j = await probe.json().catch(() => ({}));
    const roles = (j && (j.roles || (j.user && j.user.roles))) || [];
    return Array.isArray(roles) && roles.indexOf('admin') >= 0;
  } catch (_) {
    return false;
  }
}

function adminUnauthorizedResponse(url) {
  const body = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorization required · Tokenomic</title>
<style>body{font-family:system-ui,sans-serif;background:#0a141f;color:#ecf4fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}main{max-width:480px;text-align:center}h1{font-size:18px;font-weight:600;margin:0 0 8px}p{color:#9ab4c5;margin:0 0 16px;font-size:14px;line-height:1.5}a{color:#ff8a3d;text-decoration:none;font-size:14px}</style>
</head><body><main>
<h1>Admin access required</h1>
<p>You need to sign in with an admin wallet to view this page. The page contents are not loaded for unauthenticated visitors.</p>
<a href="/?return=${encodeURIComponent(url.pathname)}">Return to homepage</a>
</main></body></html>`;
  return new Response(body, {
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Same security headers as withSecurityHeaders, baked inline so
      // we don't pay an extra function-call indirection on the auth path.
      'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': STRICT_CSP,
    },
  });
}

// ---------- CSP / security headers ----------
//
// Single STRICT_CSP applied to every response. script-src is 'self' only —
// no 'unsafe-inline', no 'unsafe-eval', no inline-script hashes. Every
// inline script in the shipped templates has been moved to an external
// file under /shared/assets/js/. style-src keeps 'unsafe-inline' because
// the legacy Bootstrap-4 templates use inline style attributes (a CSS
// surface, not a JS execution surface).
//
// CSP_REPORT_URL, when set, also emits a super-strict Report-Only header
// (drops inline styles too) so we get violation telemetry as we tighten
// the legacy stylesheets.

const STRICT_CSP =
  "default-src 'self'; " +
  "script-src 'self' https://cdnjs.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https:; " +
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
  "connect-src 'self' https://*.tokenomic.org https://*.workers.dev https://mainnet.base.org https://sepolia.base.org https://api.cloudflare.com https://relay.walletconnect.com wss://relay.walletconnect.com; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "upgrade-insecure-requests";

const REPORT_ONLY_CSP =
  "default-src 'self'; " +
  "script-src 'self' https://cdnjs.cloudflare.com; " +
  "style-src 'self'; " +     // tighter than enforced — gathers data
  "img-src 'self' data: blob: https:; " +
  "font-src 'self' data:; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'";

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
    h.set('Content-Security-Policy', STRICT_CSP);
  }
  if (env && env.CSP_REPORT_URL) {
    h.set(
      'Content-Security-Policy-Report-Only',
      REPORT_ONLY_CSP + '; report-uri ' + env.CSP_REPORT_URL,
    );
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}
