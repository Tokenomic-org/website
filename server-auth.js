/**
 * Security primitives for server.js's admin login.
 *
 * These live in their own module purely so they can be unit-tested:
 * server.js calls app.listen() at module load, so requiring it from a test
 * would bind a port and open a Postgres pool.
 *
 * See the requireAdmin() comment in server.js for what this admin surface is
 * and how it differs from the SIWE-based one in workers/api-worker.
 */

var crypto = require('crypto');

/**
 * Constant-time secret comparison.
 *
 * crypto.timingSafeEqual throws when the buffers differ in length, which
 * would itself leak the length, so both sides are hashed to a fixed 32 bytes
 * first. Hashing also makes this safe for non-ASCII input.
 */
function safeEqual(a, b) {
  var ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  var hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Per-IP fixed-window throttle for login attempts.
 *
 * Deliberately in-process rather than a new dependency: server.js is a
 * single-process Replit shim, so a Map is sufficient and adds no install
 * surface. It resets when the process restarts, which is an accepted
 * limitation — this is a brute-force speed bump, not a distributed limiter.
 *
 * The store is injected so tests can drive it without touching module state.
 */
function createLoginThrottle(opts) {
  opts = opts || {};
  var maxAttempts = opts.maxAttempts || 10;
  var windowMs = opts.windowMs || 15 * 60 * 1000;
  var store = opts.store || new Map();
  var now = opts.now || function () { return Date.now(); };

  return function throttle(ip) {
    var t = now();
    var key = String(ip || 'unknown');
    var rec = store.get(key);
    if (!rec || t > rec.reset) {
      rec = { count: 0, reset: t + windowMs };
    }
    rec.count += 1;
    store.set(key, rec);

    // Opportunistic sweep so a long-running process cannot accumulate an
    // entry per attacker IP forever.
    if (store.size > 1000) {
      store.forEach(function (v, k) {
        if (t > v.reset) store.delete(k);
      });
    }
    return {
      ok: rec.count <= maxAttempts,
      remaining: Math.max(0, maxAttempts - rec.count),
      retryAfter: Math.max(1, Math.ceil((rec.reset - t) / 1000))
    };
  };
}

/** Extract the caller IP, honouring a proxy's X-Forwarded-For first hop. */
function requestIp(req) {
  var ip = (req.headers && req.headers['x-forwarded-for']) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
  return String(ip).split(',')[0].trim();
}

module.exports = { safeEqual: safeEqual, createLoginThrottle: createLoginThrottle, requestIp: requestIp };
