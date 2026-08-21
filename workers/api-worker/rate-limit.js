/**
 * Shared rate-limiting helpers for the api-worker.
 *
 * `rateLimit()` and `clientIp()` previously lived as module-private
 * functions inside index.js, which meant every route module outside that
 * file had no way to reach them — the reason content-infra.js and the four
 * role-route modules shipped with no write-volume ceiling at all.
 *
 * A note on `RATE_LIMIT_KV`, because the name is misleading: most callers of
 * that binding across the worker are NOT rate limiting. It doubles as a
 * general-purpose short-TTL KV namespace — booking holds
 * (`hold:<consultant>:<start>` in oauth-calendar.js), basename caches
 * (`bn:<name>` in referrals.js), auth nonces (d1-routes.js) and chat tickets
 * (chat-room.js) all live there. Only keys written by `rateLimit()` below
 * carry the `rl:` prefix. Grepping for `RATE_LIMIT_KV` therefore badly
 * overstates how much of the surface is actually limited.
 *
 * This module deliberately has no imports of its own. Everything it needs
 * that lives elsewhere (session reading, for wallet-keyed limits) is passed
 * in by the caller, so it stays a leaf and cannot introduce an import cycle
 * — the same shape as base64url.js.
 */

const memoryBuckets = new Map();

/**
 * Fixed-window counter backed by RATE_LIMIT_KV, falling back to an in-process
 * Map when the binding is absent (local dev) or KV errors.
 *
 * The in-memory fallback is per-isolate, so under real traffic it is a
 * best-effort backstop rather than a global limit. That is intentional: a
 * partial limit beats crashing a request path when KV is unavailable.
 */
export async function rateLimit(c, key, limit = 10, windowSec = 60) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const bucketKey = `rl:${key}`;

  if (c.env.RATE_LIMIT_KV) {
    try {
      const raw = await c.env.RATE_LIMIT_KV.get(bucketKey);
      let bucket = raw ? JSON.parse(raw) : { count: 0, reset: now + windowMs };
      if (now > bucket.reset) bucket = { count: 0, reset: now + windowMs };
      bucket.count += 1;
      const remaining = Math.max(0, limit - bucket.count);
      c.executionCtx.waitUntil(
        c.env.RATE_LIMIT_KV.put(bucketKey, JSON.stringify(bucket), { expirationTtl: windowSec + 5 })
      );
      return { ok: bucket.count <= limit, limit, remaining, reset: bucket.reset };
    } catch (e) {
      console.warn('KV rate limit failed, falling back to memory:', e.message);
    }
  }

  let bucket = memoryBuckets.get(bucketKey);
  if (!bucket || now > bucket.reset) bucket = { count: 0, reset: now + windowMs };
  bucket.count += 1;
  memoryBuckets.set(bucketKey, bucket);
  return { ok: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), reset: bucket.reset };
}

export function clientIp(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'anon';
}

/**
 * One-line guard for a single route. Returns a 429 Response when the caller
 * is over budget, or null to continue — so a handler reads:
 *
 *   const limited = await enforceRateLimit(c, `${wallet}:avatar`, 10, 60);
 *   if (limited) return limited;
 *
 * Always stamps the X-RateLimit-* headers, on the allowed path as well as
 * the rejected one, so a client can back off before it gets a 429.
 */
export async function enforceRateLimit(c, key, limit, windowSec = 60) {
  const rl = await rateLimit(c, key, limit, windowSec);
  c.header('X-RateLimit-Limit', String(rl.limit));
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  c.header('X-RateLimit-Reset', String(Math.ceil(rl.reset / 1000)));
  if (rl.ok) return null;
  const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: 'Rate limit exceeded' }, 429);
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Hono middleware that puts a ceiling on mutating requests under a route
 * prefix. Reads are never touched.
 *
 * This is a backstop against a compromised session or a client stuck in a
 * retry loop, not a throttle on normal usage — hence the generous default.
 *
 * Keying: prefers the wallet from the SIWE cookie so one signed-in user
 * cannot burn a shared NAT's IP budget, and falls back to IP when no cookie
 * session resolves (e.g. a Bearer-token client, or an unauthenticated
 * request that the route handler is about to 401 anyway).
 *
 * `resolveWallet` is injected rather than imported to keep this module free
 * of internal dependencies; index.js passes siwe.js's readSessionFromCookie.
 * It must be cheap — do NOT pass anything that hits D1 or the chain, since
 * this runs on every mutating request.
 */
export function mutationRateLimiter({ scope, resolveWallet, limit = 60, windowSec = 60 }) {
  return async function mutationRateLimitMiddleware(c, next) {
    if (!MUTATING_METHODS.has(c.req.method)) return next();

    let subject = null;
    if (typeof resolveWallet === 'function') {
      try {
        const session = await resolveWallet(c);
        const addr = session && (session.address || session.wallet);
        if (typeof addr === 'string' && addr) subject = `w:${addr.toLowerCase()}`;
      } catch (_) {
        // A malformed or expired cookie is not a rate-limit concern; fall
        // through to IP keying and let the route's own auth reject it.
      }
    }
    if (!subject) subject = `ip:${clientIp(c)}`;

    const limited = await enforceRateLimit(c, `${subject}:${scope}`, limit, windowSec);
    if (limited) return limited;
    return next();
  };
}
