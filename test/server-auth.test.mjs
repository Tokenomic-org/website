/**
 * Regression tests for server.js's admin-login security primitives.
 *
 * Run with:  npm run test:server
 *
 * Both cases correspond to a finding from the server.js admin audit:
 *
 *   1. Credentials were compared with `email !== ADMIN_EMAIL || password
 *      !== ADMIN_PASSWORD`. `!==` on strings short-circuits at the first
 *      differing byte, so response timing leaks how much of a guess was
 *      correct. safeEqual() hashes both sides and uses timingSafeEqual.
 *   2. /api/admin/login had no throttle of any kind — an attacker could
 *      grind ADMIN_PASSWORD as fast as Postgres would answer.
 *
 * These exercise the primitives, not the Express route: server.js calls
 * app.listen() at module load, so requiring it here would bind a port and
 * open a Postgres pool.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { safeEqual, createLoginThrottle, requestIp } = require('../server-auth.js');

// ───────────────────────────────────────────── constant-time comparison

test('safeEqual matches only exact strings', () => {
  assert.equal(safeEqual('hunter2', 'hunter2'), true);
  assert.equal(safeEqual('hunter2', 'hunter3'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual('a', ''), false);
});

test('safeEqual tolerates length mismatch instead of throwing', () => {
  // crypto.timingSafeEqual throws on differing buffer lengths; hashing first
  // is what keeps this from becoming a 500 on every wrong-length password.
  assert.doesNotThrow(() => safeEqual('short', 'a-much-longer-secret-value'));
  assert.equal(safeEqual('short', 'a-much-longer-secret-value'), false);
});

test('safeEqual handles non-ASCII and coerces non-strings', () => {
  assert.equal(safeEqual('pässwörd-🔐', 'pässwörd-🔐'), true);
  assert.equal(safeEqual('pässwörd-🔐', 'password-🔐'), false);
  assert.equal(safeEqual(undefined, undefined), true);
  assert.equal(safeEqual(undefined, 'undefined'), true, 'documents the String() coercion');
  assert.equal(safeEqual(null, 'x'), false);
});

// ───────────────────────────────────────────── login throttle

test('throttle blocks once the attempt budget is spent', () => {
  const throttle = createLoginThrottle({ maxAttempts: 5, windowMs: 60_000 });
  for (let i = 0; i < 5; i++) {
    assert.equal(throttle('1.2.3.4').ok, true, `attempt ${i + 1} should be allowed`);
  }
  const blocked = throttle('1.2.3.4');
  assert.equal(blocked.ok, false, '6th attempt must be blocked');
  assert.ok(blocked.retryAfter >= 1, 'a blocked attempt must say when to retry');
});

test('throttle budgets are per-IP', () => {
  const throttle = createLoginThrottle({ maxAttempts: 3, windowMs: 60_000 });
  for (let i = 0; i < 4; i++) throttle('10.0.0.1');
  assert.equal(throttle('10.0.0.1').ok, false, 'guard: first IP is exhausted');
  assert.equal(throttle('10.0.0.2').ok, true, 'a different IP must have its own budget');
});

test('throttle window resets after it expires', () => {
  let clock = 1_000_000;
  const throttle = createLoginThrottle({
    maxAttempts: 2, windowMs: 60_000, now: () => clock,
  });
  throttle('9.9.9.9');
  throttle('9.9.9.9');
  assert.equal(throttle('9.9.9.9').ok, false, 'guard: exhausted inside the window');

  clock += 60_001;
  assert.equal(throttle('9.9.9.9').ok, true, 'budget must refill once the window passes');
});

test('throttle sweeps expired entries instead of growing without bound', () => {
  let clock = 0;
  const store = new Map();
  const throttle = createLoginThrottle({
    maxAttempts: 1, windowMs: 1000, store, now: () => clock,
  });
  for (let i = 0; i < 1200; i++) throttle(`ip-${i}`);
  assert.ok(store.size > 1000, 'guard: store grew past the sweep threshold');

  clock += 5000;           // every existing entry is now expired
  throttle('trigger');     // crossing the threshold triggers the sweep
  assert.ok(store.size < 1200, `expired entries should be swept, size=${store.size}`);
});

// ───────────────────────────────────────────── client IP extraction

test('requestIp prefers the first X-Forwarded-For hop', () => {
  assert.equal(
    requestIp({ headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' }, socket: {} }),
    '203.0.113.7');
  assert.equal(requestIp({ headers: {}, socket: { remoteAddress: '198.51.100.4' } }), '198.51.100.4');
  assert.equal(requestIp({ headers: {}, socket: {} }), 'unknown');
});
