/**
 * SIWE (Sign-In With Ethereum) routes for the api-worker.
 *
 * This is the cookie-based session flow that protected pages and SSR
 * Workers should use. It complements (does not replace) the existing
 * /api/auth/nonce + /api/auth/login flow that issues a 24h JWT for the
 * fetch()-based d1-client; both are wired so a wallet sign-in via either
 * path produces a `tk_session` cookie that requireAuth() will accept.
 *
 *   GET  /api/siwe/nonce           -> { nonce, expiresInSec, message? }
 *                                     Random 32-byte nonce stored in
 *                                     RATE_LIMIT_KV under `siwe-nonce:<ip>`
 *                                     with a 5-minute TTL.
 *
 *   POST /api/siwe/verify          { address, message, signature }
 *                                  -> Set-Cookie: tk_session=<…>
 *                                     { ok: true, address, expiresAt }
 *
 *   POST /api/siwe/logout          -> clears the cookie
 *
 *   GET  /api/siwe/me              -> { address, exp } | 401
 *
 * Cookie format:
 *   tk_session = base64url({address, exp}) "." base64url(HMAC-SHA256)
 *   HMAC key   = env.SIWE_SECRET (preferred) or env.JWT_SECRET (fallback)
 *
 * Cookie attributes: HttpOnly; Secure; SameSite=Lax; Path=/;
 *                    Max-Age=604800 (7 days)
 */

import { verifyMessage } from 'viem';
import { linkReferrerOnSignIn } from './referrals.js';

const SESSION_COOKIE = 'tk_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;          // 7 days
const NONCE_TTL_SEC = 60 * 5;                       // 5 minutes
const SIWE_DOMAIN_DEFAULT = 'tokenomic.org';

// ------------------------------------------------------------------ utils

function isHexAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}
function lc(s) { return (s || '').toString().toLowerCase(); }
function clientIp(c) {
  return c.req.header('cf-connecting-ip') ||
         c.req.header('x-forwarded-for') ||
         '0.0.0.0';
}
function b64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
function sessionSecret(env) {
  return env.SIWE_SECRET || env.JWT_SECRET || '';
}

// ------------------------------------------------------------------ session token

export async function signSession(payload, secret) {
  const enc = new TextEncoder();
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token, secret) {
  if (typeof token !== 'string' || token.split('.').length !== 2) return null;
  const [body, sig] = token.split('.');
  const enc = new TextEncoder();
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(body));
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))); }
  catch { return null; }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  if (!isHexAddress(payload.address)) return null;
  return payload;
}

function setSessionCookie(c, token, ttlSec) {
  // SameSite=None is required because the api-worker is on a different
  // eTLD+1 than the static site (workers.dev vs tokenomic.org); browsers
  // drop SameSite=Lax cookies on cross-site fetch(credentials:'include').
  // Secure is mandatory whenever SameSite=None is used.
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${ttlSec}`,
    'HttpOnly',
    'Secure',
    'SameSite=None',
  ];
  c.header('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(c) {
  c.header('Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`);
}

function readCookie(c, name) {
  const raw = c.req.header('cookie') || '';
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return null;
}

// ------------------------------------------------------------------ middleware

/**
 * Resolve the authenticated wallet from either:
 *   1. Bearer JWT (existing /api/auth/login flow)  — handled by caller
 *   2. tk_session cookie (this module)
 *
 * Returns { address, exp } on success, null otherwise. Does NOT short-circuit
 * the request; callers compose with their own 401 response.
 */
export async function readSessionFromCookie(c) {
  const secret = sessionSecret(c.env);
  if (!secret) return null;
  const token = readCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return await verifySession(token, secret);
}

/**
 * Hono middleware factory: gates a route behind a valid SIWE cookie.
 * Use as: app.get('/api/protected', requireAuth(), handler)
 */
export function requireAuth() {
  return async (c, next) => {
    const session = await readSessionFromCookie(c);
    if (!session) return c.json({ error: 'Authentication required' }, 401);
    c.set('siwe', session);
    await next();
  };
}

// ------------------------------------------------------------------ SIWE message

/**
 * Build the canonical SIWE message that the client must sign. We follow the
 * shape recommended by EIP-4361 (without enforcing the full grammar) so the
 * wallet UI shows a clean prompt and the on-chain audit story stays clean.
 */
function buildSiweMessage({ domain, address, nonce, issuedAt, chainId, statement, uri }) {
  const lines = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    statement || 'Sign in to Tokenomic. This signature does not authorize any transaction or fee.',
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ];
  return lines.join('\n');
}

/**
 * Parse an EIP-4361 message into structured fields. Returns null if the
 * required fields are missing/malformed. We are intentionally permissive on
 * optional fields (statement, requestId, resources) but strict on the bits we
 * validate against (domain, address, chainId, nonce, issuedAt).
 *
 * Canonical message shape:
 *   ${domain} wants you to sign in with your Ethereum account:
 *   ${address}
 *
 *   ${statement}            (optional, may be blank)
 *
 *   URI: ${uri}
 *   Version: 1
 *   Chain ID: ${chainId}
 *   Nonce: ${nonce}
 *   Issued At: ${iso8601}
 *   Expiration Time: ${iso8601}   (optional)
 *   Not Before: ${iso8601}        (optional)
 *   Request ID: ${id}             (optional)
 *   Resources:                    (optional)
 *   - ${uri1}
 *   - ${uri2}
 */
function parseSiweMessage(msg) {
  if (typeof msg !== 'string') return null;
  const lines = msg.replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 6) return null;

  const header = lines[0] || '';
  const m = header.match(/^([^\s]+) wants you to sign in with your Ethereum account:$/);
  if (!m) return null;
  const domain = m[1];

  const address = (lines[1] || '').trim();
  if (!isHexAddress(address)) return null;

  const out = { domain, address };
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('URI: ')) out.uri = line.slice(5).trim();
    else if (line.startsWith('Version: ')) out.version = line.slice(9).trim();
    else if (line.startsWith('Chain ID: ')) out.chainId = Number(line.slice(10).trim());
    else if (line.startsWith('Nonce: ')) out.nonce = line.slice(7).trim();
    else if (line.startsWith('Issued At: ')) out.issuedAt = line.slice(11).trim();
    else if (line.startsWith('Expiration Time: ')) out.expirationTime = line.slice(17).trim();
    else if (line.startsWith('Not Before: ')) out.notBefore = line.slice(12).trim();
  }
  if (out.version && out.version !== '1') return null;
  if (!Number.isFinite(out.chainId)) return null;
  if (!out.nonce || !out.issuedAt) return null;
  return out;
}

// ------------------------------------------------------------------ routes

export function mountSiweRoutes(app) {

  app.get('/api/siwe/nonce', async (c) => {
    if (!c.env.RATE_LIMIT_KV) return c.json({ error: 'Nonce store not configured' }, 503);
    // Nonce is keyed by its own value, not by IP. This eliminates NAT/proxy
    // collisions and lets /verify consume the exact nonce that appears in the
    // signed SIWE message — true one-time semantics.
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
    await c.env.RATE_LIMIT_KV.put(
      `siwe-nonce:${nonce}`,
      '1',
      { expirationTtl: NONCE_TTL_SEC },
    );
    return c.json({ nonce, expiresInSec: NONCE_TTL_SEC });
  });

  app.post('/api/siwe/verify', async (c) => {
    const secret = sessionSecret(c.env);
    if (!secret) return c.json({ error: 'SIWE_SECRET / JWT_SECRET not configured' }, 503);
    if (!c.env.RATE_LIMIT_KV) return c.json({ error: 'Nonce store not configured' }, 503);

    let body = {};
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const address = body.address;
    const message = body.message;
    const signature = body.signature;

    if (!isHexAddress(address)) return c.json({ error: 'Invalid address' }, 400);
    if (typeof message !== 'string' || message.length > 4000) {
      return c.json({ error: 'Invalid message' }, 400);
    }
    if (typeof signature !== 'string' || !signature.startsWith('0x')) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // --- EIP-4361 message parse + claim validation ---------------------
    const parsed = parseSiweMessage(message);
    if (!parsed) return c.json({ error: 'Malformed SIWE message' }, 400);

    // Allow either a single SIWE_DOMAIN or a comma-separated SIWE_DOMAINS
    // allowlist so canonical+www (and staging) hosts can both verify against
    // the same worker without rebuilding. Each entry must match exactly —
    // no wildcards, no path/port games.
    const allowedDomains = ((c.env.SIWE_DOMAINS || c.env.SIWE_DOMAIN || SIWE_DOMAIN_DEFAULT) + '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const expectedDomain = allowedDomains[0];
    if (!allowedDomains.includes(parsed.domain)) {
      return c.json({ error: `Domain mismatch (expected ${expectedDomain})` }, 401);
    }
    if (lc(parsed.address) !== lc(address)) {
      return c.json({ error: 'Address in message does not match claimed address' }, 401);
    }
    const allowedChains = new Set([8453, 84532]); // Base mainnet + Sepolia
    if (!allowedChains.has(parsed.chainId)) {
      return c.json({ error: `Chain ${parsed.chainId} not allowed` }, 401);
    }
    // Freshness window: issuedAt must be within the nonce TTL on either side.
    const nowMs = Date.now();
    const issuedMs = Date.parse(parsed.issuedAt || '');
    if (!Number.isFinite(issuedMs) || Math.abs(nowMs - issuedMs) > NONCE_TTL_SEC * 1000) {
      return c.json({ error: 'Message issuedAt is outside the freshness window' }, 401);
    }
    if (parsed.expirationTime) {
      const expMs = Date.parse(parsed.expirationTime);
      if (Number.isFinite(expMs) && expMs <= nowMs) {
        return c.json({ error: 'Message has expired' }, 401);
      }
    }
    if (typeof parsed.nonce !== 'string' || parsed.nonce.length < 8) {
      return c.json({ error: 'Nonce missing from message' }, 401);
    }

    // --- One-time nonce consumption ------------------------------------
    const nonceKey = `siwe-nonce:${parsed.nonce}`;
    const exists = await c.env.RATE_LIMIT_KV.get(nonceKey);
    if (!exists) {
      return c.json({ error: 'Nonce not found, expired, or already used' }, 401);
    }
    // Consume regardless of signature outcome to prevent brute-force retry.
    await c.env.RATE_LIMIT_KV.delete(nonceKey);

    let valid = false;
    try {
      valid = await verifyMessage({ address, message, signature });
    } catch (e) {
      return c.json({ error: 'Signature verification failed: ' + e.message }, 401);
    }
    if (!valid) return c.json({ error: 'Signature does not match address' }, 401);

    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
    const token = await signSession({ address: lc(address), exp }, secret);
    setSessionCookie(c, token, SESSION_TTL_SEC);

    // Phase 5: if a `tk_ref` cookie is set from a /r/<handle> visit and
    // this wallet has no referrer recorded yet, persist the (referrer,
    // referee) pair and clear the cookie. Best-effort — failures must
    // never block the sign-in itself.
    try { await linkReferrerOnSignIn(c, address); } catch (_) {}

    return c.json({ ok: true, address: lc(address), expiresAt: exp });
  });

  app.post('/api/siwe/logout', async (c) => {
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/api/siwe/me', async (c) => {
    const session = await readSessionFromCookie(c);
    if (!session) return c.json({ error: 'Not signed in' }, 401);
    return c.json({ address: session.address, exp: session.exp });
  });

  // Convenience: lets the client fetch the canonical message text. The
  // client may also build the message locally — both paths are valid so
  // long as the signed bytes match what /verify recomputes.
  app.post('/api/siwe/message', async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const address = body.address;
    const nonce = body.nonce;
    const chainId = Number(body.chainId || 8453);
    if (!isHexAddress(address)) return c.json({ error: 'Invalid address' }, 400);
    if (typeof nonce !== 'string' || nonce.length < 8) return c.json({ error: 'Invalid nonce' }, 400);
    const domain = c.env.SIWE_DOMAIN || SIWE_DOMAIN_DEFAULT;
    const uri = `https://${domain}`;
    const message = buildSiweMessage({
      domain,
      address,
      nonce,
      issuedAt: new Date().toISOString(),
      chainId,
      uri,
      statement: body.statement,
    });
    return c.json({ message });
  });
}

export const SIWE_CONFIG = { SESSION_COOKIE, SESSION_TTL_SEC, NONCE_TTL_SEC };
