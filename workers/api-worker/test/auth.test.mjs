/**
 * Regression tests for the api-worker auth + CORS layer.
 *
 * Run with:  npm run test:workers
 *
 * Every case here corresponds to a bug that silently broke the signed-in
 * product surface, so please keep them passing:
 *
 *   1. base64url padding — `'=='.slice((len + 3) % 4)` emits the wrong
 *      number of `=` when len % 4 === 2, which is exactly the shape of a
 *      {address, exp} session payload. `atob` threw, verifySession()
 *      swallowed it, and every signed-in user was bounced to 401.
 *   2. requireRole() admin early-return — gates that list 'admin' as one
 *      of several acceptable roles (educator, consultant, learner) 403'd
 *      every non-admin, taking out all three workbenches.
 *   3. cors({ origin: null }) — Hono treats a non-string, non-function
 *      origin as an array and calls `.includes()` on it, turning every
 *      request from a non-allowlisted origin into a 500.
 *
 * The suite uses in-memory D1/KV doubles; it asserts status codes and
 * auth decisions, not row shapes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import app from '../index.js';
import { signSession, verifySession } from '../siwe.js';
import { b64urlEncode, b64urlDecode } from '../base64url.js';
import { privateKeyToAccount } from 'viem/accounts';

const SECRET = 'test-secret-value-at-least-32-bytes-long!!';
const ADMIN  = '0xaaaabbbbccccddddeeeeffff0000111122223333';
const EDU    = '0x1111111111111111111111111111111111111111';
const CONS   = '0x2222222222222222222222222222222222222222';
const PLAIN  = '0x3333333333333333333333333333333333333333';

const PROFILE_ROLES = { [EDU]: '["educator"]', [CONS]: '["consultant"]' };

function mockDB() {
  const mk = (binds = []) => ({
    bind: (...a) => mk(a),
    all: async () => ({ results: [], success: true, meta: {} }),
    first: async () => {
      const w = (binds[0] || '').toString().toLowerCase();
      return PROFILE_ROLES[w] ? { roles: PROFILE_ROLES[w] } : null;
    },
    run: async () => ({ success: true, meta: { changes: 0 } }),
  });
  return { prepare: () => mk(), batch: async () => [], exec: async () => ({}) };
}
function mockKV() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async () => ({ keys: [], list_complete: true }),
  };
}
const makeEnv = (over = {}) => ({
  SIWE_SECRET: SECRET, JWT_SECRET: SECRET,
  DB: mockDB(), RATE_LIMIT_KV: mockKV(), COMMENTS_KV: mockKV(),
  ADMIN_WALLETS: ADMIN, SIWE_DOMAIN: 'tokenomic.org', DEV_MODE: '0',
  ...over,
});
const CTX = { waitUntil() {}, passThroughOnException() {} };

const cookieFor = async (wallet, ttl = 3600) =>
  `tk_session=${await signSession(
    { address: wallet, exp: Math.floor(Date.now() / 1000) + ttl }, SECRET)}`;

async function call(path, { wallet, env = makeEnv(), method = 'GET', origin = 'https://tokenomic.org' } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (wallet) headers.cookie = await cookieFor(wallet);
  return app.fetch(new Request('https://x.test' + path, { method, headers }), env, CTX);
}

// ───────────────────────────────────────────── 1. base64url

test('base64url round-trips every byte length', () => {
  for (let n = 0; n <= 96; n++) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 7 + 3) & 0xff);
    const back = b64urlDecode(b64urlEncode(bytes));
    assert.equal(back.length, n, `length mismatch at ${n} bytes`);
    assert.deepEqual([...back], [...bytes], `payload mismatch at ${n} bytes`);
  }
});

test('base64url tolerates already-padded input', () => {
  assert.deepEqual([...b64urlDecode('AAAA')], [0, 0, 0]);
  assert.deepEqual([...b64urlDecode('AAA=')], [0, 0]);
  assert.deepEqual([...b64urlDecode('AA==')], [0]);
});

test('session token round-trips (73-byte payload is the regression case)', async () => {
  const exp = Math.floor(Date.now() / 1000) + 604800;
  const payload = { address: PLAIN, exp };
  assert.equal(JSON.stringify(payload).length, 73, 'guard: this is the payload that broke');
  const back = await verifySession(await signSession(payload, SECRET), SECRET);
  assert.deepEqual(back, payload);
});

test('session token round-trips across payload sizes', async () => {
  for (let n = 0; n < 24; n++) {
    const payload = { address: PLAIN, exp: Math.floor(Date.now() / 1000) + 3600, pad: 'x'.repeat(n) };
    assert.notEqual(await verifySession(await signSession(payload, SECRET), SECRET), null,
      `failed at pad length ${n}`);
  }
});

test('session token rejects a tampered body and a bad secret', async () => {
  const token = await signSession({ address: PLAIN, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const [body, sig] = token.split('.');
  assert.equal(await verifySession(`${body}x.${sig}`, SECRET), null);
  assert.equal(await verifySession(token, SECRET + 'x'), null);
});

test('expired sessions are rejected', async () => {
  const token = await signSession({ address: PLAIN, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
  assert.equal(await verifySession(token, SECRET), null);
});

// ───────────────────────────────────────────── 2. role gating

test('learner routes admit any signed-in wallet', async () => {
  for (const w of [PLAIN, EDU, CONS, ADMIN]) {
    assert.equal((await call('/api/me/courses', { wallet: w })).status, 200, `wallet ${w}`);
  }
});

test('learner routes reject anonymous callers', async () => {
  assert.equal((await call('/api/me/courses')).status, 401);
});

test('educator workbench admits educators and admins only', async () => {
  const p = '/api/educator/me/courses';
  assert.equal((await call(p, { wallet: EDU   })).status, 200);
  assert.equal((await call(p, { wallet: ADMIN })).status, 200);
  assert.equal((await call(p, { wallet: CONS  })).status, 403);
  assert.equal((await call(p, { wallet: PLAIN })).status, 403);
});

test('consultant workbench admits consultants and admins only', async () => {
  const p = '/api/consultant/me/services';
  assert.equal((await call(p, { wallet: CONS  })).status, 200);
  assert.equal((await call(p, { wallet: ADMIN })).status, 200);
  assert.equal((await call(p, { wallet: EDU   })).status, 403);
  assert.equal((await call(p, { wallet: PLAIN })).status, 403);
});

test('admin-only routes require the ADMIN_WALLETS allowlist', async () => {
  assert.equal((await call('/admin/users', { wallet: ADMIN })).status, 200);
  for (const w of [EDU, CONS, PLAIN]) {
    assert.equal((await call('/admin/users', { wallet: w })).status, 403, `wallet ${w}`);
  }
  assert.equal((await call('/admin/users')).status, 401);
});

test('an on-chain/D1 "admin" role does not grant admin without the allowlist', async () => {
  // profiles.roles claims admin, but the wallet is absent from ADMIN_WALLETS.
  const env = makeEnv({ ADMIN_WALLETS: '' });
  env.DB = (() => {
    const mk = () => ({
      bind: () => mk(),
      all: async () => ({ results: [] }),
      first: async () => ({ roles: '["admin","educator"]' }),
      run: async () => ({ success: true }),
    });
    return { prepare: () => mk() };
  })();
  assert.equal((await call('/admin/users', { wallet: PLAIN, env })).status, 403);
});

// ───────────────────────────────────────────── 3. CORS

test('CORS reflects allowlisted origins and declines others without 500ing', async () => {
  const allowed = await call('/api/health', { origin: 'https://tokenomic.org' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://tokenomic.org');

  const wildcard = await call('/api/health', { origin: 'https://app.tokenomic.org' });
  assert.equal(wildcard.headers.get('access-control-allow-origin'), 'https://app.tokenomic.org');

  const denied = await call('/api/health', { origin: 'https://evil.example' });
  assert.ok(denied.status < 500, `expected no server error, got ${denied.status}`);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('CORS allows non-browser callers that send no Origin', async () => {
  const res = await call('/api/health', { origin: null });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('preflight from an allowlisted origin succeeds', async () => {
  const res = await app.fetch(new Request('https://x.test/api/siwe/verify', {
    method: 'OPTIONS',
    headers: { origin: 'https://tokenomic.org', 'access-control-request-method': 'POST' },
  }), makeEnv(), CTX);
  assert.ok(res.status === 204 || res.status === 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://tokenomic.org');
});

// ───────────────────────────────────────────── 4. full SIWE login

test('SIWE login: nonce -> real signature -> cookie -> authenticated call', async () => {
  const account = privateKeyToAccount(
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const env = makeEnv();
  const H = { origin: 'https://tokenomic.org', 'content-type': 'application/json' };

  const { nonce } = await (await app.fetch(
    new Request('https://x.test/api/siwe/nonce', { headers: H }), env, CTX)).json();
  assert.ok(nonce && nonce.length >= 8);

  const message = [
    'tokenomic.org wants you to sign in with your Ethereum account:',
    account.address, '',
    'Sign in to Tokenomic. This signature does not authorize any transaction or fee.', '',
    'URI: https://tokenomic.org', 'Version: 1', 'Chain ID: 8453',
    'Nonce: ' + nonce, 'Issued At: ' + new Date().toISOString(),
  ].join('\n');
  const signature = await account.signMessage({ message });
  const body = JSON.stringify({ address: account.address.toLowerCase(), message, signature });

  const verified = await app.fetch(new Request('https://x.test/api/siwe/verify',
    { method: 'POST', headers: H, body }), env, CTX);
  assert.equal(verified.status, 200);

  const cookie = (verified.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('tk_session='));

  // The regression: the cookie was issued but never verified afterwards.
  const me = await app.fetch(new Request('https://x.test/api/siwe/me',
    { headers: { ...H, cookie } }), env, CTX);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).address, account.address.toLowerCase());

  // Nonces are single-use.
  const replay = await app.fetch(new Request('https://x.test/api/siwe/verify',
    { method: 'POST', headers: H, body }), env, CTX);
  assert.equal(replay.status, 401);
});

test('SIWE verify rejects a signature from the wrong key', async () => {
  const signer = privateKeyToAccount(
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const env = makeEnv();
  const H = { origin: 'https://tokenomic.org', 'content-type': 'application/json' };
  const { nonce } = await (await app.fetch(
    new Request('https://x.test/api/siwe/nonce', { headers: H }), env, CTX)).json();

  // Message claims a different address than the one that signs it.
  const message = [
    'tokenomic.org wants you to sign in with your Ethereum account:',
    PLAIN, '',
    'Sign in to Tokenomic. This signature does not authorize any transaction or fee.', '',
    'URI: https://tokenomic.org', 'Version: 1', 'Chain ID: 8453',
    'Nonce: ' + nonce, 'Issued At: ' + new Date().toISOString(),
  ].join('\n');
  const signature = await signer.signMessage({ message });

  const res = await app.fetch(new Request('https://x.test/api/siwe/verify', {
    method: 'POST', headers: H,
    body: JSON.stringify({ address: PLAIN, message, signature }),
  }), env, CTX);
  assert.equal(res.status, 401);
});

// ───────────────────────────────────────────── 4. rate limiting

// These share one env per test so the KV bucket actually accumulates —
// makeEnv() hands out a fresh mock KV each call, which would otherwise reset
// the counter on every request and make the limit untestable.

async function callWith(env, path, { wallet, method = 'GET', body } = {}) {
  const headers = { origin: 'https://tokenomic.org' };
  if (wallet) headers.cookie = await cookieFor(wallet);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.fetch(new Request('https://x.test' + path, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env, CTX);
}

test('upload routes reject once the per-wallet limit is spent', async () => {
  const env = makeEnv();
  const post = () => callWith(env, '/api/profile/avatar', {
    wallet: PLAIN, method: 'POST', body: { photo: 'not-a-data-url' },
  });

  // /api/profile/avatar is capped at 10/min. The first ten get past the
  // limiter (and then fail validation on the bogus data URL, which is fine —
  // we are asserting the limiter, not the handler).
  for (let i = 0; i < 10; i++) {
    const res = await post();
    assert.notEqual(res.status, 429, `request ${i + 1} should not have been limited`);
  }

  const limited = await post();
  assert.equal(limited.status, 429, '11th upload in the window must be rejected');
  assert.equal((await limited.json()).error, 'Rate limit exceeded');
  assert.ok(limited.headers.get('retry-after'), 'a 429 must tell the client when to retry');
});

test('rate-limit headers count down and never go negative', async () => {
  const env = makeEnv();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const res = await callWith(env, '/api/profile/avatar', {
      wallet: PLAIN, method: 'POST', body: { photo: 'x' },
    });
    seen.push(Number(res.headers.get('x-ratelimit-remaining')));
  }
  assert.equal(seen[0], 9, 'first request should report 9 of 10 left');
  assert.ok(seen.every((n) => Number.isFinite(n) && n >= 0), 'remaining must never go negative');
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] <= seen[i - 1], `remaining must be monotonic (index ${i})`);
  }
});

test('mutation limiter guards role routes but leaves reads alone', async () => {
  const env = makeEnv();

  // GETs must pass through untouched however many arrive — the middleware
  // only counts POST/PATCH/PUT/DELETE.
  for (let i = 0; i < 70; i++) {
    const res = await callWith(env, '/api/me/profile', { wallet: PLAIN });
    assert.notEqual(res.status, 429, `read ${i + 1} must never be rate limited`);
  }

  // Mutations on the same prefix share a 60/min per-wallet budget.
  for (let i = 0; i < 60; i++) {
    const res = await callWith(env, '/api/me/profile', {
      wallet: PLAIN, method: 'PATCH', body: { display_name: 'x' },
    });
    assert.notEqual(res.status, 429, `mutation ${i + 1} should be within budget`);
  }
  const over = await callWith(env, '/api/me/profile', {
    wallet: PLAIN, method: 'PATCH', body: { display_name: 'x' },
  });
  assert.equal(over.status, 429, '61st mutation in the window must be rejected');
});

test('one wallet cannot spend another wallet key budget', async () => {
  const env = makeEnv();
  const spend = (wallet) => callWith(env, '/api/profile/avatar', {
    wallet, method: 'POST', body: { photo: 'x' },
  });

  for (let i = 0; i < 11; i++) await spend(PLAIN);
  assert.equal((await spend(PLAIN)).status, 429, 'guard: PLAIN should be exhausted');

  const other = await spend(EDU);
  assert.notEqual(other.status, 429, 'a different wallet must have its own budget');
});

// ───────────────────────────────────────────── 5. error-message hygiene

test('availability failures return a generic message, not exception text', async () => {
  // A D1 binding that is present but fails on use, so the handler gets past
  // its `!c.env.DB` 503 guard and into the catch. Before the fix that catch
  // returned `{ error: e.message }`, spilling the query detail to the caller.
  const boom = new Error('D1_ERROR: no such table: calendar_accounts');
  const env = makeEnv({ DB: { prepare() { throw boom; }, batch() { throw boom; }, exec() { throw boom; } } });
  const res = await callWith(env, `/api/availability/${PLAIN}`, { wallet: PLAIN });

  assert.notEqual(res.status, 404, 'guard: the route must exist, or this asserts nothing');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'Could not load availability');
  assert.ok(!('message' in body), 'must not attach an exception message');
});

test('the global error handler does not leak exception text', async () => {
  // app.onError previously returned `message: err.message` alongside the
  // generic error string, which defeated the point of the generic string.
  const src = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../index.js', import.meta.url), 'utf8'));
  const onError = src.slice(src.indexOf('app.onError('));
  assert.ok(!/message:\s*err\.message/.test(onError.slice(0, 400)),
    'app.onError must not echo err.message to the client');
});
