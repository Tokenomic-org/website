/**
 * D1-backed routes for the Tokenomic API worker.
 *
 * Replaces the old Supabase Postgres backend. All reads are public; all
 * writes require an Authorization: Bearer <jwt> header. JWTs are issued
 * by /api/auth/login after the caller proves ownership of a wallet via
 * an EIP-191 signature.
 *
 * Routes:
 *   POST /api/auth/nonce          { wallet }            -> { nonce, message }
 *   POST /api/auth/login          { wallet, signature } -> { token, expiresAt }
 *   GET  /api/auth/whoami         (Bearer)              -> { wallet, expiresAt }
 *
 *   GET  /api/profile/:wallet
 *   POST /api/profile             (Bearer) upsert own profile
 *
 *   GET  /api/courses             ?community_id=&educator=&category=&level=&q=
 *   GET  /api/courses/:idOrSlug
 *   POST /api/courses             (Bearer)
 *
 *   GET  /api/communities         ?educator=&category=
 *   GET  /api/communities/:idOrSlug
 *   POST /api/communities         (Bearer)
 *
 *   GET  /api/articles            ?category=&author=
 *   GET  /api/articles/:slug
 *   POST /api/articles            (Bearer)
 *
 *   GET  /api/experts             ?role=educator|consultant
 *   GET  /api/experts/:wallet
 *
 *   GET  /api/revenue/:wallet
 *   POST /api/revenue             (Bearer)  records a tx hash
 *
 *   GET  /api/bookings/:wallet
 *   POST /api/bookings            (Bearer)
 *
 *   GET  /api/enrollments/:wallet
 *   POST /api/enrollments         (Bearer)
 *
 *   GET  /api/messages/:communityId
 *   POST /api/messages            (Bearer)
 */

import { verifyMessage } from 'viem';
import { readSessionFromCookie } from './siwe.js';
import { isSubscriptionActive } from './subscription.js';
import { sendEmail, logEmail, tplWelcome } from './mail.js';

// ---------- helpers ----------

function isHexAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}
function lc(s) { return (s || '').toString().toLowerCase(); }
function isValidSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-_]{0,128}$/i.test(s);
}
function jsonOrNull(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
function dbReady(c) {
  if (!c.env.DB) {
    return c.json({ error: 'D1 database not bound (set DB binding in wrangler.toml)' }, 503);
  }
  return null;
}

// ---------- JWT (HS256 over Web Crypto) ----------

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
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
    ['sign', 'verify']
  );
}
async function signJwt(payload, secret, ttlSec = 86400) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const enc = new TextEncoder();
  const headerB = b64url(enc.encode(JSON.stringify(header)));
  const bodyB   = b64url(enc.encode(JSON.stringify(body)));
  const data = `${headerB}.${bodyB}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}
async function verifyJwt(token, secret) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const [h, b, s] = token.split('.');
  const enc = new TextEncoder();
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(s), enc.encode(`${h}.${b}`));
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(b))); } catch { return null; }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

async function requireAuth(c) {
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  // Path 1 — Bearer JWT (legacy /api/auth/login flow). Always tried first
  // because it's explicit and lets API clients (CI, scripts) bypass cookie
  // semantics entirely.
  if (token) {
    const secret = c.env.JWT_SECRET;
    if (!secret) return { error: c.json({ error: 'JWT_SECRET not configured on worker' }, 503) };
    const payload = await verifyJwt(token, secret);
    if (!payload || !isHexAddress(payload.wallet)) {
      return { error: c.json({ error: 'Invalid or expired token' }, 401) };
    }
    return { wallet: lc(payload.wallet), exp: payload.exp };
  }

  // Path 2 — SIWE cookie (Phase 0 /api/siwe/verify flow). Browser sessions
  // sign in once and ride the HTTP-only `tk_session` cookie for all
  // subsequent protected calls.
  const session = await readSessionFromCookie(c);
  if (session && isHexAddress(session.address)) {
    return { wallet: lc(session.address), exp: session.exp };
  }

  return { error: c.json({ error: 'Authentication required (Bearer token or SIWE cookie)' }, 401) };
}

/**
 * Resolve the caller's wallet WITHOUT 401-ing when no credentials are
 * present. Used by routes that gracefully degrade for anonymous readers
 * (e.g. the article paywall, which must serve an excerpt to everyone).
 * Returns `{ wallet }` or `{ wallet: null }`.
 */
async function getOptionalAuth(c) {
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    const secret = c.env.JWT_SECRET;
    if (secret) {
      const payload = await verifyJwt(token, secret);
      if (payload && isHexAddress(payload.wallet)) return { wallet: lc(payload.wallet) };
    }
  }
  try {
    const session = await readSessionFromCookie(c);
    if (session && isHexAddress(session.address)) return { wallet: lc(session.address) };
  } catch (_) { /* swallow */ }
  return { wallet: null };
}

/** Truncate `body` to its first N paragraphs (split on blank lines or </p>). */
function truncateToParagraphs(body, n = 3) {
  if (typeof body !== 'string' || !body) return '';
  // Prefer HTML-paragraph splitting when the body looks like HTML.
  if (/<\/p>/i.test(body)) {
    const m = body.match(/<p[\s\S]*?<\/p>/gi) || [];
    return m.slice(0, n).join('\n');
  }
  // Otherwise split on blank lines (markdown / plain text).
  const parts = body.split(/\n\s*\n/).filter(Boolean);
  return parts.slice(0, n).join('\n\n');
}

// Admin gate. Authenticates first, then checks env.ADMIN_WALLETS (bootstrap)
// or the profile.roles JSON column. Returns { wallet } on success or
// { error } with a Hono Response on failure.
async function requireAdmin(c) {
  const auth = await requireAuth(c);
  if (auth.error) return auth;
  const adminEnv = (c.env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  let isAdmin = adminEnv.includes(auth.wallet);
  if (!isAdmin && c.env.DB) {
    const p = await c.env.DB.prepare('SELECT roles FROM profiles WHERE wallet_address = ?').bind(auth.wallet).first();
    const parsed = p ? jsonOrNull(p.roles) : null;
    isAdmin = Array.isArray(parsed) && parsed.includes('admin');
  }
  if (!isAdmin) return { error: c.json({ error: 'Admin only' }, 403) };
  return { wallet: auth.wallet };
}

// Best-effort audit row writer (never throws).
async function audit(env, actor, action, target_type, target_id, metadata) {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_log (actor_wallet, action, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).bind(actor, action, target_type, String(target_id || ''),
            metadata ? JSON.stringify(metadata) : null).run();
  } catch (_) { /* swallow */ }
}

// ---------- nonce store (KV) ----------

async function putNonce(env, wallet, nonce) {
  if (!env.RATE_LIMIT_KV) return;
  await env.RATE_LIMIT_KV.put(`auth-nonce:${lc(wallet)}`, nonce, { expirationTtl: 600 });
}
async function takeNonce(env, wallet) {
  if (!env.RATE_LIMIT_KV) return null;
  const k = `auth-nonce:${lc(wallet)}`;
  const v = await env.RATE_LIMIT_KV.get(k);
  if (v) await env.RATE_LIMIT_KV.delete(k);
  return v;
}
function loginMessage(wallet, nonce) {
  return `Sign in to tokenomic.org\n\nWallet: ${lc(wallet)}\nNonce: ${nonce}\n\nThis signature does not authorize any transaction or fee.`;
}

// ---------- mount ----------

export function mountD1Routes(app) {

  // -------- auth --------

  app.post('/api/auth/nonce', async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch {}
    const wallet = body.wallet;
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    const nonce = crypto.randomUUID();
    await putNonce(c.env, wallet, nonce);
    return c.json({ nonce, message: loginMessage(wallet, nonce), expiresInSec: 600 });
  });

  app.post('/api/auth/login', async (c) => {
    if (!c.env.JWT_SECRET) return c.json({ error: 'JWT_SECRET not configured' }, 503);
    let body = {};
    try { body = await c.req.json(); } catch {}
    const { wallet, signature } = body || {};
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    if (typeof signature !== 'string' || !signature.startsWith('0x')) return c.json({ error: 'Invalid signature' }, 400);
    const nonce = await takeNonce(c.env, wallet);
    if (!nonce) return c.json({ error: 'Nonce not found or expired — request a new one' }, 401);
    const message = loginMessage(wallet, nonce);
    let valid = false;
    try { valid = await verifyMessage({ address: wallet, message, signature }); }
    catch (e) { return c.json({ error: 'Signature verification failed: ' + e.message }, 401); }
    if (!valid) return c.json({ error: 'Signature does not match wallet' }, 401);
    const token = await signJwt({ wallet: lc(wallet) }, c.env.JWT_SECRET, 86400);
    return c.json({ token, wallet: lc(wallet), expiresInSec: 86400 });
  });

  app.get('/api/auth/whoami', async (c) => {
    const auth = await requireAuth(c);
    if (auth.error) return auth.error;
    return c.json({ wallet: auth.wallet, exp: auth.exp });
  });

  // -------- profiles / experts --------

  app.get('/api/profile/:wallet', async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.req.param('wallet'));
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM profiles WHERE wallet_address = ?').bind(wallet).first();
    return c.json(row || null);
  });

  app.post('/api/profile', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const wallet = auth.wallet;

    // Read existing row so a partial update doesn't blow away other fields.
    const existing = await c.env.DB.prepare('SELECT * FROM profiles WHERE wallet_address = ?').bind(wallet).first();

    const pick = (next, prev) => (next !== undefined ? next : prev);
    const display_name = pick(body.display_name, existing && existing.display_name) || null;
    // Legacy single-role column: only allow non-privileged values from the
    // client. 'admin' must never be self-assigned via /api/profile.
    const SELF_ASSIGNABLE_ROLES = ['student', 'learner', 'educator', 'consultant'];
    const legacyRole = SELF_ASSIGNABLE_ROLES.includes(body.role)
                          ? body.role : (existing && existing.role) || 'learner';
    const bio          = pick(body.bio, existing && existing.bio) || null;
    const specialty    = pick(body.specialty, existing && existing.specialty) || null;
    const avatar_url   = pick(body.avatar_url, existing && existing.avatar_url) || null;
    const email        = pick(body.email, existing && existing.email) || null;
    const rate_30      = body.rate_30 != null ? Number(body.rate_30) : (existing && existing.rate_30) || null;
    const rate_60      = body.rate_60 != null ? Number(body.rate_60) : (existing && existing.rate_60) || null;
    // SECURITY: roles[] mutations are NEVER accepted from /api/profile —
    // promotions happen only through admin-approved /api/applications and
    // (next session) /api/admin/applications/:id/approve. We always re-derive
    // roles from the existing row, NOT from the request body.
    let roles = (existing && existing.roles) || '["learner"]';
    // Ditto for `approved` — a user can't self-approve themselves; preserve
    // whatever the existing row had (defaults to 1 for fresh signups so the
    // current public profile flow keeps working).
    const approved = existing ? existing.approved : 1;

    await c.env.DB.prepare(`
      INSERT INTO profiles (wallet_address, display_name, role, roles, bio, specialty, email, avatar_url, rate_30, rate_60, approved, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(wallet_address) DO UPDATE SET
        display_name   = excluded.display_name,
        role           = excluded.role,
        roles          = excluded.roles,
        bio            = excluded.bio,
        specialty      = excluded.specialty,
        email          = excluded.email,
        avatar_url     = excluded.avatar_url,
        rate_30        = excluded.rate_30,
        rate_60        = excluded.rate_60,
        approved       = excluded.approved,
        last_active_at = excluded.last_active_at
    `).bind(wallet, display_name, legacyRole, roles, bio, specialty, email, avatar_url, rate_30, rate_60, approved).run();

    const row = await c.env.DB.prepare('SELECT * FROM profiles WHERE wallet_address = ?').bind(wallet).first();

    // Phase 6: send a welcome email the first time a wallet completes
    // its profile (i.e. the row didn't exist before this PUT) AND we
    // have a deliverable email on file. Fire-and-forget; failures are
    // logged to email_log but never block profile creation.
    if (!existing && row && row.email) {
      try {
        const tpl = tplWelcome({ name: row.display_name || null, dashboardUrl: 'https://tokenomic.org/dashboard/' });
        const send = await sendEmail(c.env, { to: row.email, ...tpl });
        await logEmail(c.env, {
          recipient: row.email, template: 'welcome', subject: tpl.subject,
          status: send.ok ? 'sent' : 'failed', error: send.error || null,
          message_id: send.message_id || null, meta: { wallet },
        });
      } catch (_) { /* never block profile creation */ }
    }

    return c.json({ ok: true, profile: row });
  });

  // -------- session: who am I + my computed roles --------
  // Returns the profile row PLUS a normalized roles[] array so the dashboard
  // can render role-aware UI without parsing JSON twice.
  app.get('/api/auth/me', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const wallet = auth.wallet;
    const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE wallet_address = ?').bind(wallet).first();
    let roles = ['learner'];
    if (profile && profile.roles) {
      const parsed = jsonOrNull(profile.roles);
      if (Array.isArray(parsed) && parsed.length) roles = parsed;
    }
    // Bootstrap admin: any wallet listed in env.ADMIN_WALLETS (comma sep) is
    // treated as admin even if their D1 row hasn't been promoted yet.
    const adminEnv = (c.env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (adminEnv.includes(wallet) && !roles.includes('admin')) roles = roles.concat(['admin']);
    return c.json({ wallet, roles, profile: profile || null });
  });

  // -------- applications (educator / consultant) --------

  app.get('/api/applications/me', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM applications WHERE applicant_wallet = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(auth.wallet).all();
    return c.json({ items: results || [] });
  });

  app.post('/api/applications', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const role_requested = body.role_requested === 'consultant' ? 'consultant' : 'educator';
    const bio = (body.bio || '').toString().slice(0, 4000);
    if (bio.length < 200) return c.json({ error: 'Bio must be at least 200 characters' }, 400);
    const expertise = Array.isArray(body.expertise) ? JSON.stringify(body.expertise.slice(0, 8)) : null;
    const sample_url = body.sample_url || null;
    const portfolio_url = body.portfolio_url || null;
    const hourly_rate_usdc = role_requested === 'consultant' && body.hourly_rate_usdc
      ? Number(body.hourly_rate_usdc) : null;
    const availability = body.availability || null;
    const credentials  = body.credentials  || null;
    const stake_tx_hash = (typeof body.stake_tx_hash === 'string' && body.stake_tx_hash.startsWith('0x'))
      ? body.stake_tx_hash : null;

    // Reject if the applicant already holds the requested role.
    const myProfile = await c.env.DB.prepare('SELECT roles FROM profiles WHERE wallet_address = ?').bind(auth.wallet).first();
    const myRoles = myProfile ? (jsonOrNull(myProfile.roles) || []) : [];
    if (Array.isArray(myRoles) && myRoles.includes(role_requested)) {
      return c.json({ error: 'You already hold the ' + role_requested + ' role' }, 409);
    }
    // Also reject if a previous application for the same role is still pending.
    const dup = await c.env.DB.prepare(
      "SELECT id FROM applications WHERE applicant_wallet = ? AND role_requested = ? AND status = 'pending' LIMIT 1"
    ).bind(auth.wallet, role_requested).first();
    if (dup) return c.json({ error: 'A pending application for this role already exists' }, 409);

    const ins = await c.env.DB.prepare(`
      INSERT INTO applications (applicant_wallet, role_requested, bio, expertise, sample_url,
        portfolio_url, hourly_rate_usdc, availability, credentials, stake_tx_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(auth.wallet, role_requested, bio, expertise, sample_url, portfolio_url,
            hourly_rate_usdc, availability, credentials, stake_tx_hash).run();

    await c.env.DB.prepare(`
      INSERT INTO audit_log (actor_wallet, action, target_type, target_id, metadata)
      VALUES (?, 'application.submitted', 'application', ?, ?)
    `).bind(auth.wallet, String(ins.meta.last_row_id || ''),
            JSON.stringify({ role_requested })).run().catch(() => {});

    return c.json({ ok: true, id: ins.meta.last_row_id, status: 'pending' }, 201);
  });

  // -------- admin queue (read) --------
  app.get('/api/admin/queue', async (c) => {
    const r = dbReady(c); if (r) return r;
    const adm = await requireAdmin(c); if (adm.error) return adm.error;

    const type = c.req.query('type') || 'all';
    const status = c.req.query('status') || 'pending_review';
    const out = {};
    const want = (t) => type === 'all' || type === t;

    if (want('applications')) {
      const { results } = await c.env.DB.prepare(
        "SELECT * FROM applications WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100"
      ).all();
      out.applications = results || [];
    }
    if (want('courses')) {
      const { results } = await c.env.DB.prepare(
        'SELECT id, slug, title, educator_wallet, status, submitted_at, created_at FROM courses WHERE status = ? ORDER BY submitted_at DESC LIMIT 100'
      ).bind(status).all();
      out.courses = results || [];
    }
    if (want('communities')) {
      const { results } = await c.env.DB.prepare(
        'SELECT id, slug, name, educator_wallet, status, submitted_at, created_at FROM communities WHERE status = ? ORDER BY submitted_at DESC LIMIT 100'
      ).bind(status).all();
      out.communities = results || [];
    }
    if (want('articles')) {
      const { results } = await c.env.DB.prepare(
        'SELECT id, slug, title, author_wallet, status, submitted_at, created_at FROM articles WHERE status = ? ORDER BY submitted_at DESC LIMIT 100'
      ).bind(status).all();
      out.articles = results || [];
    }
    const counts = {
      applications: (out.applications || []).length,
      courses:      (out.courses      || []).length,
      communities:  (out.communities  || []).length,
      articles:     (out.articles     || []).length
    };
    counts.total = counts.applications + counts.courses + counts.communities + counts.articles;
    return c.json({ ok: true, counts, items: out });
  });

  // -------- admin mutations: applications --------

  app.post('/api/admin/applications/:id/approve', async (c) => {
    const r = dbReady(c); if (r) return r;
    const adm = await requireAdmin(c); if (adm.error) return adm.error;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const appRow = await c.env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first();
    if (!appRow) return c.json({ error: 'Application not found' }, 404);
    if (appRow.status !== 'pending') return c.json({ error: 'Application is not pending' }, 409);

    const targetWallet = lc(appRow.applicant_wallet);
    const newRole = appRow.role_requested === 'consultant' ? 'consultant' : 'educator';

    // Append the granted role to profiles.roles JSON. Create a stub profile
    // if the applicant has none yet so the grant is never lost.
    const existing = await c.env.DB.prepare('SELECT * FROM profiles WHERE wallet_address = ?').bind(targetWallet).first();
    let roles = existing && existing.roles ? jsonOrNull(existing.roles) : null;
    if (!Array.isArray(roles)) roles = ['learner'];
    if (!roles.includes(newRole)) roles.push(newRole);
    const rolesJson = JSON.stringify(roles);

    if (existing) {
      await c.env.DB.prepare(
        'UPDATE profiles SET roles = ?, role = ?, approved = 1 WHERE wallet_address = ?'
      ).bind(rolesJson, newRole, targetWallet).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO profiles (wallet_address, role, roles, approved) VALUES (?, ?, ?, 1)'
      ).bind(targetWallet, newRole, rolesJson).run();
    }

    await c.env.DB.prepare(`
      UPDATE applications
      SET status = 'approved', granted_at = datetime('now'),
          reviewed_by = ?, reviewed_at = datetime('now'), admin_feedback = NULL
      WHERE id = ?
    `).bind(adm.wallet, id).run();

    await audit(c.env, adm.wallet, 'application.approved', 'application', id,
                { applicant: targetWallet, role: newRole });

    return c.json({ ok: true, id, status: 'approved', granted_role: newRole });
  });

  app.post('/api/admin/applications/:id/reject', async (c) => {
    const r = dbReady(c); if (r) return r;
    const adm = await requireAdmin(c); if (adm.error) return adm.error;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    let body = {}; try { body = await c.req.json(); } catch {}
    const feedback = (body.admin_feedback || '').toString().trim();
    if (feedback.length < 10) return c.json({ error: 'admin_feedback (≥10 chars) required' }, 400);

    const appRow = await c.env.DB.prepare('SELECT id, status FROM applications WHERE id = ?').bind(id).first();
    if (!appRow) return c.json({ error: 'Application not found' }, 404);
    if (appRow.status !== 'pending') return c.json({ error: 'Application is not pending' }, 409);

    await c.env.DB.prepare(`
      UPDATE applications
      SET status = 'rejected', admin_feedback = ?,
          reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).bind(feedback.slice(0, 2000), adm.wallet, id).run();

    await audit(c.env, adm.wallet, 'application.rejected', 'application', id, { feedback: feedback.slice(0, 200) });
    return c.json({ ok: true, id, status: 'rejected' });
  });

  // -------- admin mutations: content (courses / communities / articles) --------
  // Generic helper so we don't repeat ourselves four times.
  function mountContentReview(table, type, approvedStatus, rejectedStatus) {
    app.post(`/api/admin/${type}/:id/approve`, async (c) => {
      const r = dbReady(c); if (r) return r;
      const adm = await requireAdmin(c); if (adm.error) return adm.error;
      const id = Number(c.req.param('id'));
      if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
      const row = await c.env.DB.prepare(`SELECT id, status FROM ${table} WHERE id = ?`).bind(id).first();
      if (!row) return c.json({ error: `${type} not found` }, 404);
      await c.env.DB.prepare(`
        UPDATE ${table}
        SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), admin_feedback = NULL
        WHERE id = ?
      `).bind(approvedStatus, adm.wallet, id).run();
      await audit(c.env, adm.wallet, `${type}.approved`, type, id);
      return c.json({ ok: true, id, status: approvedStatus });
    });

    app.post(`/api/admin/${type}/:id/reject`, async (c) => {
      const r = dbReady(c); if (r) return r;
      const adm = await requireAdmin(c); if (adm.error) return adm.error;
      const id = Number(c.req.param('id'));
      if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
      let body = {}; try { body = await c.req.json(); } catch {}
      const feedback = (body.admin_feedback || '').toString().trim();
      if (feedback.length < 10) return c.json({ error: 'admin_feedback (≥10 chars) required' }, 400);
      const row = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first();
      if (!row) return c.json({ error: `${type} not found` }, 404);
      await c.env.DB.prepare(`
        UPDATE ${table}
        SET status = ?, admin_feedback = ?,
            reviewed_by = ?, reviewed_at = datetime('now')
        WHERE id = ?
      `).bind(rejectedStatus, feedback.slice(0, 2000), adm.wallet, id).run();
      await audit(c.env, adm.wallet, `${type}.rejected`, type, id, { feedback: feedback.slice(0, 200) });
      return c.json({ ok: true, id, status: rejectedStatus });
    });
  }
  // Articles use 'published' as their live state; courses/communities use 'active'.
  mountContentReview('courses',     'courses',     'active',    'needs_changes');
  mountContentReview('communities', 'communities', 'active',    'needs_changes');
  mountContentReview('articles',    'articles',    'published', 'needs_changes');

  // -------- submit-for-review (creator -> admin queue) --------
  // Owner-gated: only the creator can submit their own draft.
  function mountSubmitForReview(table, type, ownerCol) {
    app.post(`/api/${type}/:id/submit`, async (c) => {
      const r = dbReady(c); if (r) return r;
      const auth = await requireAuth(c); if (auth.error) return auth.error;
      const id = Number(c.req.param('id'));
      if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
      const row = await c.env.DB.prepare(`SELECT id, ${ownerCol} AS owner, status FROM ${table} WHERE id = ?`).bind(id).first();
      if (!row) return c.json({ error: `${type} not found` }, 404);
      if (lc(row.owner) !== auth.wallet) return c.json({ error: 'Not your draft' }, 403);
      if (row.status === 'pending_review') return c.json({ ok: true, id, status: 'pending_review', noop: true });
      await c.env.DB.prepare(`
        UPDATE ${table}
        SET status = 'pending_review', submitted_at = datetime('now')
        WHERE id = ?
      `).bind(id).run();
      await audit(c.env, auth.wallet, `${type}.submitted`, type, id);
      return c.json({ ok: true, id, status: 'pending_review' });
    });
  }
  mountSubmitForReview('courses',     'courses',     'educator_wallet');
  mountSubmitForReview('communities', 'communities', 'educator_wallet');
  mountSubmitForReview('articles',    'articles',    'author_wallet');

  app.get('/api/experts', async (c) => {
    const r = dbReady(c); if (r) return r;
    const role = c.req.query('role'); // 'educator' | 'consultant' | undefined (both)
    let sql = "SELECT * FROM profiles WHERE approved = 1 AND role IN ('educator','consultant')";
    const binds = [];
    if (role === 'educator' || role === 'consultant') {
      sql = "SELECT * FROM profiles WHERE approved = 1 AND role = ?";
      binds.push(role);
    }
    sql += ' ORDER BY xp DESC LIMIT 200';
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  app.get('/api/experts/:wallet', async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.req.param('wallet'));
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE wallet_address = ?').bind(wallet).first();
    if (!profile) return c.json({ error: 'Not found' }, 404);
    const communities = (await c.env.DB.prepare('SELECT id, name, slug, members_count FROM communities WHERE educator_wallet = ?').bind(wallet).all()).results || [];
    const courses     = (await c.env.DB.prepare('SELECT id, slug, title, price_usdc, level FROM courses WHERE educator_wallet = ? AND status = ?').bind(wallet, 'active').all()).results || [];
    return c.json({ profile, communities, courses });
  });

  // -------- courses --------

  app.get('/api/courses', async (c) => {
    const r = dbReady(c); if (r) return r;
    const where = ['status = ?']; const binds = ['active'];
    const cId = c.req.query('community_id');
    if (cId) { where.push('community_id = ?'); binds.push(Number(cId)); }
    const ed  = c.req.query('educator');
    if (isHexAddress(ed)) { where.push('educator_wallet = ?'); binds.push(lc(ed)); }
    const cat = c.req.query('category');
    if (cat) { where.push('category = ?'); binds.push(cat); }
    const lvl = c.req.query('level');
    if (lvl) { where.push('level = ?'); binds.push(lvl); }
    const q   = c.req.query('q');
    if (q) { where.push('(title LIKE ? OR description LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }
    const sql = `SELECT * FROM courses WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    const items = (results || []).map(r => ({ ...r, what_you_learn: jsonOrNull(r.what_you_learn) || [] }));
    return c.json({ items, count: items.length });
  });

  app.get('/api/courses/:idOrSlug', async (c) => {
    const r = dbReady(c); if (r) return r;
    const k = c.req.param('idOrSlug');
    const isNumeric = /^\d+$/.test(k);
    const sql = isNumeric ? 'SELECT * FROM courses WHERE id = ?' : 'SELECT * FROM courses WHERE slug = ?';
    const row = await c.env.DB.prepare(sql).bind(isNumeric ? Number(k) : k).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ ...row, what_you_learn: jsonOrNull(row.what_you_learn) || [] });
  });

  app.post('/api/courses', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const slug = body.slug;
    if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug' }, 400);
    if (!body.title || body.title.length < 3) return c.json({ error: 'Title required' }, 400);
    const fields = [
      slug, body.title.slice(0, 200), (body.description || '').slice(0, 4000),
      auth.wallet, (body.educator_name || '').slice(0, 100), body.community_id || null,
      body.category || null, body.level || null, Number(body.price_usdc || 0),
      Number(body.modules_count || 0), Number(body.estimated_hours || 0),
      Array.isArray(body.what_you_learn) ? JSON.stringify(body.what_you_learn) : null,
      body.thumbnail_url || null, body.stream_video_uid || null,
      body.status || 'active', body.on_chain_course_id || null
    ];
    try {
      const res = await c.env.DB.prepare(`
        INSERT INTO courses
        (slug, title, description, educator_wallet, educator_name, community_id, category, level, price_usdc,
         modules_count, estimated_hours, what_you_learn, thumbnail_url, stream_video_uid, status, on_chain_course_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(...fields).run();
      const id = res.meta && res.meta.last_row_id;
      const row = await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first();
      return c.json({ ok: true, course: { ...row, what_you_learn: jsonOrNull(row.what_you_learn) || [] } });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Slug already taken' }, 409);
      throw e;
    }
  });

  // Update editable course fields. Owner-gated (educator_wallet === auth.wallet)
  // OR caller is admin.
  app.patch('/api/courses/:id', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    const course = await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first();
    if (!course) return c.json({ error: 'Course not found' }, 404);
    const isOwner = lc(course.educator_wallet) === auth.wallet;
    let isAdmin = false;
    if (!isOwner) {
      const adminEnv = (c.env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      isAdmin = adminEnv.includes(auth.wallet);
      if (!isAdmin) {
        const p = await c.env.DB.prepare('SELECT roles FROM profiles WHERE wallet_address = ?').bind(auth.wallet).first();
        const parsed = p ? jsonOrNull(p.roles) : null;
        isAdmin = Array.isArray(parsed) && parsed.includes('admin');
      }
    }
    if (!isOwner && !isAdmin) return c.json({ error: 'Not your course' }, 403);

    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const sets = [], binds = [];
    const stringField = (key, max) => {
      if (typeof body[key] === 'string') { sets.push(`${key} = ?`); binds.push(body[key].slice(0, max)); }
    };
    const numField = (key) => {
      if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
        const n = Number(body[key]); if (Number.isFinite(n)) { sets.push(`${key} = ?`); binds.push(n); }
      }
    };
    stringField('title', 200);
    stringField('description', 4000);
    stringField('category', 80);
    stringField('level', 40);
    stringField('thumbnail_url', 500);
    stringField('stream_video_uid', 100);
    // price/hours: validate non-negative.
    if (body.price_usdc !== undefined && body.price_usdc !== null && body.price_usdc !== '') {
      const n = Number(body.price_usdc);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return c.json({ error: 'price_usdc must be a non-negative number' }, 400);
      sets.push('price_usdc = ?'); binds.push(n);
    }
    if (body.estimated_hours !== undefined && body.estimated_hours !== null && body.estimated_hours !== '') {
      const n = Number(body.estimated_hours);
      if (!Number.isFinite(n) || n < 0 || n > 100000) return c.json({ error: 'estimated_hours must be a non-negative number' }, 400);
      sets.push('estimated_hours = ?'); binds.push(n);
    }
    if (Array.isArray(body.what_you_learn)) {
      sets.push('what_you_learn = ?'); binds.push(JSON.stringify(body.what_you_learn.slice(0, 50)));
    }
    if (body.status === 'draft' || body.status === 'active' || body.status === 'archived') {
      sets.push('status = ?'); binds.push(body.status);
    }
    if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    await audit(c.env, auth.wallet, 'course.update', 'course', id, { fields: sets.length });
    const row = await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first();
    return c.json({ ok: true, course: { ...row, what_you_learn: jsonOrNull(row.what_you_learn) || [] } });
  });

  // -------- modules --------

  // Internal: load course + verify caller owns it (or is admin).
  async function loadCourseAsOwner(c, id) {
    const auth = await requireAuth(c);
    if (auth.error) return { fail: auth.error };
    const cid = Number(id);
    if (!Number.isFinite(cid) || cid <= 0) return { fail: c.json({ error: 'Bad course id' }, 400) };
    const course = await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(cid).first();
    if (!course) return { fail: c.json({ error: 'Course not found' }, 404) };
    if (lc(course.educator_wallet) === auth.wallet) return { auth, course };
    const adminEnv = (c.env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (adminEnv.includes(auth.wallet)) return { auth, course };
    const p = await c.env.DB.prepare('SELECT roles FROM profiles WHERE wallet_address = ?').bind(auth.wallet).first();
    const parsed = p ? jsonOrNull(p.roles) : null;
    if (Array.isArray(parsed) && parsed.includes('admin')) return { auth, course };
    return { fail: c.json({ error: 'Not your course' }, 403) };
  }

  // Atomic recompute of modules_count to avoid TOCTOU between read+write.
  // We use a subquery so the COUNT and UPDATE happen as a single statement;
  // SQLite/D1 evaluate subqueries against the same snapshot as the outer write.
  async function refreshModuleCount(env, courseId) {
    await env.DB.prepare(
      'UPDATE courses SET modules_count = (SELECT COUNT(*) FROM modules WHERE course_id = ?) WHERE id = ?'
    ).bind(courseId, courseId).run();
  }

  // Public list of modules for a course.
  //
  // Phase 6 hardening: `video_uid` is the Cloudflare Stream identifier and
  // must NOT leak to anonymous / non-owner callers — anyone holding a UID
  // could embed an unsigned iframe and bypass the enrollment-gated signed
  // playback flow. We therefore strip the column for public callers and
  // expose only `has_video: boolean`. Owners and admins still receive the
  // raw UID so the dashboard editor can manage modules.
  app.get('/api/courses/:id/modules', async (c) => {
    const r = dbReady(c); if (r) return r;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    const course = await c.env.DB.prepare('SELECT id, educator_wallet FROM courses WHERE id = ?').bind(id).first();
    if (!course) return c.json({ error: 'Course not found' }, 404);
    const opt = await getOptionalAuth(c);
    const callerWallet = opt && opt.wallet ? lc(opt.wallet) : null;
    let isPrivileged = false;
    if (callerWallet) {
      if (lc(course.educator_wallet) === callerWallet) isPrivileged = true;
      else {
        const adminEnv = (c.env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (adminEnv.includes(callerWallet)) isPrivileged = true;
        else {
          const p = await c.env.DB.prepare('SELECT roles FROM profiles WHERE wallet_address = ?').bind(callerWallet).first();
          try { if (p && Array.isArray(JSON.parse(p.roles || '[]')) && JSON.parse(p.roles).includes('admin')) isPrivileged = true; } catch (_) {}
        }
      }
    }
    const { results } = await c.env.DB.prepare(
      'SELECT id, course_id, position, title, body_md, video_uid, duration_minutes, created_at, updated_at FROM modules WHERE course_id = ? ORDER BY position ASC, id ASC'
    ).bind(id).all();
    const items = (results || []).map(m => {
      const has_video = !!m.video_uid;
      if (isPrivileged) return Object.assign({}, m, { has_video });
      const { video_uid, ...rest } = m;
      return Object.assign({}, rest, { has_video });
    });
    return c.json({ items, count: items.length });
  });

  // Append a new module.
  app.post('/api/courses/:id/modules', async (c) => {
    const r = dbReady(c); if (r) return r;
    const gate = await loadCourseAsOwner(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const title = (body.title || '').toString().trim();
    if (title.length < 2 || title.length > 200) return c.json({ error: 'Title 2-200 chars' }, 400);
    const bodyMd = typeof body.body_md === 'string' ? body.body_md.slice(0, 100000) : '';
    const videoUid = typeof body.video_uid === 'string' && body.video_uid.length <= 100 ? body.video_uid : null;
    const dur = body.duration_minutes != null && body.duration_minutes !== '' ? Number(body.duration_minutes) : null;
    const duration = Number.isFinite(dur) && dur >= 0 && dur <= 100000 ? Math.round(dur) : null;
    const maxRow = await c.env.DB.prepare('SELECT MAX(position) AS m FROM modules WHERE course_id = ?').bind(gate.course.id).first();
    const nextPos = ((maxRow && maxRow.m) || 0) + 1;
    const res = await c.env.DB.prepare(`
      INSERT INTO modules (course_id, position, title, body_md, video_uid, duration_minutes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(gate.course.id, nextPos, title, bodyMd, videoUid, duration).run();
    const id = res.meta && res.meta.last_row_id;
    await refreshModuleCount(c.env, gate.course.id);
    await audit(c.env, gate.auth.wallet, 'module.create', 'module', id, { course_id: gate.course.id });
    const row = await c.env.DB.prepare('SELECT * FROM modules WHERE id = ?').bind(id).first();
    return c.json({ ok: true, module: row });
  });

  // Update a module.
  app.patch('/api/modules/:id', async (c) => {
    const r = dbReady(c); if (r) return r;
    // Auth first so we don't leak module-id existence to unauth callers.
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const mid = Number(c.req.param('id'));
    if (!Number.isFinite(mid) || mid <= 0) return c.json({ error: 'Bad id' }, 400);
    const m = await c.env.DB.prepare('SELECT * FROM modules WHERE id = ?').bind(mid).first();
    if (!m) return c.json({ error: 'Module not found' }, 404);
    const gate = await loadCourseAsOwner(c, m.course_id);
    if (gate.fail) return gate.fail;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const sets = [], binds = [];
    if (typeof body.title === 'string') {
      const t = body.title.trim();
      if (t.length < 2 || t.length > 200) return c.json({ error: 'Title 2-200 chars' }, 400);
      sets.push('title = ?'); binds.push(t);
    }
    if (typeof body.body_md === 'string') { sets.push('body_md = ?'); binds.push(body.body_md.slice(0, 100000)); }
    if (body.video_uid === null || body.video_uid === '') { sets.push('video_uid = NULL'); }
    else if (typeof body.video_uid === 'string' && body.video_uid.length <= 100) { sets.push('video_uid = ?'); binds.push(body.video_uid); }
    if (body.duration_minutes === null || body.duration_minutes === '') { sets.push('duration_minutes = NULL'); }
    else if (body.duration_minutes != null) {
      const n = Number(body.duration_minutes);
      if (Number.isFinite(n) && n >= 0 && n <= 100000) { sets.push('duration_minutes = ?'); binds.push(Math.round(n)); }
    }
    if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
    sets.push("updated_at = datetime('now')");
    binds.push(mid);
    await c.env.DB.prepare(`UPDATE modules SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    await audit(c.env, gate.auth.wallet, 'module.update', 'module', mid, { course_id: m.course_id });
    const row = await c.env.DB.prepare('SELECT * FROM modules WHERE id = ?').bind(mid).first();
    return c.json({ ok: true, module: row });
  });

  // Delete a module and recompact positions.
  app.delete('/api/modules/:id', async (c) => {
    const r = dbReady(c); if (r) return r;
    // Auth first so we don't leak module-id existence to unauth callers.
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const mid = Number(c.req.param('id'));
    if (!Number.isFinite(mid) || mid <= 0) return c.json({ error: 'Bad id' }, 400);
    const m = await c.env.DB.prepare('SELECT * FROM modules WHERE id = ?').bind(mid).first();
    if (!m) return c.json({ error: 'Module not found' }, 404);
    const gate = await loadCourseAsOwner(c, m.course_id);
    if (gate.fail) return gate.fail;
    await c.env.DB.prepare('DELETE FROM modules WHERE id = ?').bind(mid).run();
    // Recompact positions so they remain a 1..N sequence.
    const { results } = await c.env.DB.prepare(
      'SELECT id FROM modules WHERE course_id = ? ORDER BY position ASC, id ASC'
    ).bind(m.course_id).all();
    let pos = 1;
    for (const row of (results || [])) {
      await c.env.DB.prepare('UPDATE modules SET position = ? WHERE id = ?').bind(pos++, row.id).run();
    }
    await refreshModuleCount(c.env, m.course_id);
    await audit(c.env, gate.auth.wallet, 'module.delete', 'module', mid, { course_id: m.course_id });
    return c.json({ ok: true });
  });

  // Reorder modules. Body: { ids: [moduleId, …] } in desired order.
  app.post('/api/courses/:id/modules/reorder', async (c) => {
    const r = dbReady(c); if (r) return r;
    const gate = await loadCourseAsOwner(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => Number.isFinite(n) && n > 0) : null;
    if (!ids || !ids.length) return c.json({ error: 'ids[] required' }, 400);
    if (new Set(ids).size !== ids.length) return c.json({ error: 'duplicate ids' }, 400);
    // Verify every id belongs to this course and the set is complete.
    const { results } = await c.env.DB.prepare('SELECT id FROM modules WHERE course_id = ?').bind(gate.course.id).all();
    const owned = new Set((results || []).map(r => r.id));
    if (owned.size !== ids.length || !ids.every(id => owned.has(id))) {
      return c.json({ error: 'ids must match all modules of this course exactly' }, 400);
    }
    // Apply all reorders atomically via D1 batch (single transaction).
    // Without this, a partial failure could leave duplicate positions.
    const stmts = ids.map((id, i) => c.env.DB.prepare(
      "UPDATE modules SET position = ?, updated_at = datetime('now') WHERE id = ? AND course_id = ?"
    ).bind(i + 1, id, gate.course.id));
    await c.env.DB.batch(stmts);
    await audit(c.env, gate.auth.wallet, 'module.reorder', 'course', gate.course.id, { count: ids.length });
    return c.json({ ok: true });
  });

  // -------- communities --------

  app.get('/api/communities', async (c) => {
    const r = dbReady(c); if (r) return r;
    const where = ["status = 'active'"]; const binds = [];
    const ed = c.req.query('educator');
    if (isHexAddress(ed)) { where.push('educator_wallet = ?'); binds.push(lc(ed)); }
    const cat = c.req.query('category');
    if (cat) { where.push('category = ?'); binds.push(cat); }
    const sql = `SELECT * FROM communities WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  app.get('/api/communities/:idOrSlug', async (c) => {
    const r = dbReady(c); if (r) return r;
    const k = c.req.param('idOrSlug');
    const isNumeric = /^\d+$/.test(k);
    const sql = isNumeric ? 'SELECT * FROM communities WHERE id = ?' : 'SELECT * FROM communities WHERE slug = ?';
    const row = await c.env.DB.prepare(sql).bind(isNumeric ? Number(k) : k).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    const courses = (await c.env.DB.prepare('SELECT id, slug, title, price_usdc, level FROM courses WHERE community_id = ? AND status = ?').bind(row.id, 'active').all()).results || [];
    return c.json({ ...row, courses });
  });

  app.post('/api/communities', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const slug = body.slug;
    if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug' }, 400);
    if (!body.name || body.name.length < 3) return c.json({ error: 'Name required' }, 400);
    try {
      const res = await c.env.DB.prepare(`
        INSERT INTO communities
        (slug, name, description, educator_wallet, educator_name, category, level, access_price_usdc, thumbnail_url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        slug, body.name.slice(0, 200), (body.description || '').slice(0, 4000),
        auth.wallet, (body.educator_name || '').slice(0, 100),
        body.category || null, body.level || null,
        Number(body.access_price_usdc || 0), body.thumbnail_url || null,
        body.status || 'active'
      ).run();
      const id = res.meta && res.meta.last_row_id;
      const row = await c.env.DB.prepare('SELECT * FROM communities WHERE id = ?').bind(id).first();
      return c.json({ ok: true, community: row });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Slug already taken' }, 409);
      throw e;
    }
  });

  // -------- articles --------

  app.get('/api/articles', async (c) => {
    const r = dbReady(c); if (r) return r;
    const where = ["status = 'published'"]; const binds = [];
    const cat = c.req.query('category');
    if (cat) { where.push('category = ?'); binds.push(cat); }
    const author = c.req.query('author');
    if (isHexAddress(author)) { where.push('author_wallet = ?'); binds.push(lc(author)); }
    // Paywall: never include `body` in list responses. The full body is
    // only ever served by /api/articles/:slug after subscription /
    // authorship checks. Returning `body` here would let an anonymous
    // caller exfiltrate paid content via the public list endpoint.
    const sql = `
      SELECT id, slug, title, excerpt, category,
             author_wallet, author_name, author_avatar,
             image_url, reading_time, status, published_at, created_at
      FROM articles
      WHERE ${where.join(' AND ')}
      ORDER BY published_at DESC, created_at DESC
      LIMIT 200`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  app.get('/api/articles/:slug', async (c) => {
    const r = dbReady(c); if (r) return r;
    const slug = c.req.param('slug');
    if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM articles WHERE slug = ?').bind(slug).first();
    if (!row) return c.json({ error: 'Not found' }, 404);

    // ---- Server-side paywall ----
    // Anonymous and non-subscribers see the first 3 paragraphs of `body`
    // plus the full metadata. The author of the article is always allowed
    // to read their own work in full.
    const { wallet } = await getOptionalAuth(c);
    let allowFull = false;
    let reason = 'anonymous';
    if (wallet) {
      reason = 'no_subscription';
      if (lc(row.author_wallet || '') === wallet) {
        allowFull = true; reason = 'author';
      } else if (await isSubscriptionActive(c.env, wallet)) {
        allowFull = true; reason = 'subscribed';
      }
    }

    if (allowFull) {
      return c.json({ ...row, paywalled: false, paywall_reason: reason });
    }
    const fullLength = row.body ? String(row.body).length : 0;
    const excerpt = truncateToParagraphs(row.body, 3);
    return c.json({
      ...row,
      body: excerpt,
      body_truncated: fullLength > excerpt.length,
      paywalled: true,
      paywall_reason: reason,
      paywall_message: wallet
        ? 'Subscribe to read the full article.'
        : 'Sign in and subscribe to read the full article.',
    });
  });

  app.post('/api/articles', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    if (!isValidSlug(body.slug)) return c.json({ error: 'Invalid slug' }, 400);
    if (!body.title || body.title.length < 3) return c.json({ error: 'Title required' }, 400);
    try {
      const res = await c.env.DB.prepare(`
        INSERT INTO articles
        (slug, title, excerpt, body, category, author_wallet, author_name, author_avatar, image_url, reading_time, status, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        body.slug, body.title.slice(0, 300), (body.excerpt || '').slice(0, 1000),
        body.body || '', body.category || null, auth.wallet,
        (body.author_name || '').slice(0, 100), body.author_avatar || null,
        body.image_url || null, Number(body.reading_time || 0),
        body.status || 'published', body.published_at || new Date().toISOString().slice(0, 10)
      ).run();
      const id = res.meta && res.meta.last_row_id;
      const row = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
      return c.json({ ok: true, article: row });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Slug already taken' }, 409);
      throw e;
    }
  });

  // -------- revenue --------

  app.get('/api/revenue/:wallet', async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.req.param('wallet'));
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM revenue_tx WHERE recipient_wallet = ? ORDER BY created_at DESC LIMIT 200'
    ).bind(wallet).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  app.post('/api/revenue', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    if (typeof body.tx_hash !== 'string' || !/^0x[0-9a-fA-F]{6,80}$/.test(body.tx_hash)) {
      return c.json({ error: 'Invalid tx_hash' }, 400);
    }
    try {
      await c.env.DB.prepare(`
        INSERT INTO revenue_tx (tx_hash, amount_usdc, sender_wallet, recipient_wallet, description, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        body.tx_hash, Number(body.amount_usdc || 0),
        isHexAddress(body.sender_wallet) ? lc(body.sender_wallet) : auth.wallet,
        isHexAddress(body.recipient_wallet) ? lc(body.recipient_wallet) : auth.wallet,
        (body.description || '').slice(0, 500), body.status || 'confirmed'
      ).run();
      return c.json({ ok: true });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Transaction already recorded' }, 409);
      throw e;
    }
  });

  // -------- bookings --------
  // Privacy: bookings carry client_wallet + topic. Both consultant and client
  // sides require auth and only ever see rows where THEY are a party.

  // Consultant view: bookings made TO me.
  app.get('/api/bookings/:wallet', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const wallet = lc(c.req.param('wallet'));
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    if (wallet !== auth.wallet) return c.json({ error: 'You can only read your own bookings' }, 403);
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM bookings WHERE consultant_wallet = ? ORDER BY booking_date ASC LIMIT 200'
    ).bind(wallet).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  // Client view: bookings I made (as the buyer).
  app.get('/api/bookings/me/as-client', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM bookings WHERE client_wallet = ? ORDER BY booking_date ASC LIMIT 200'
    ).bind(auth.wallet).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  app.post('/api/bookings', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    if (!isHexAddress(body.consultant_wallet)) return c.json({ error: 'Invalid consultant_wallet' }, 400);
    const res = await c.env.DB.prepare(`
      INSERT INTO bookings (consultant_wallet, client_wallet, client_name, topic, booking_date, time_slot, duration, price_usdc, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      lc(body.consultant_wallet), auth.wallet,
      (body.client_name || '').slice(0, 100), (body.topic || '').slice(0, 200),
      body.booking_date || null, body.time_slot || null,
      Number(body.duration || 60), Number(body.price_usdc || 0),
      body.status || 'pending'
    ).run();
    const id = res.meta && res.meta.last_row_id;
    const row = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    return c.json({ ok: true, booking: row });
  });

  // Consultant-only: accept a booking → status='confirmed'.
  app.post('/api/bookings/:id/accept', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Booking not found' }, 404);
    if (lc(row.consultant_wallet) !== auth.wallet) return c.json({ error: 'Only the consultant can accept this booking' }, 403);
    if (row.status === 'confirmed') return c.json({ ok: true, booking: row });
    if (row.status === 'declined' || row.status === 'cancelled') return c.json({ error: `Cannot accept a ${row.status} booking` }, 409);
    // Conditional update guards against concurrent accept/decline races.
    const upd = await c.env.DB.prepare(
      "UPDATE bookings SET status = 'confirmed' WHERE id = ? AND status = 'pending'"
    ).bind(id).run();
    if (!upd.meta || upd.meta.changes !== 1) {
      const fresh = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
      return c.json({ error: 'Booking state changed; refresh and retry', booking: fresh }, 409);
    }
    const updated = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    await audit(c.env, auth.wallet, 'booking.accepted', 'booking', id);
    return c.json({ ok: true, booking: updated });
  });

  // Consultant-only: decline a booking with a short reason → status='declined'.
  app.post('/api/bookings/:id/decline', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    let body = {}; try { body = await c.req.json(); } catch {}
    const reason = ((body && body.reason) || '').toString().trim();
    if (reason.length < 5) return c.json({ error: 'A reason of at least 5 characters is required' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Booking not found' }, 404);
    if (lc(row.consultant_wallet) !== auth.wallet) return c.json({ error: 'Only the consultant can decline this booking' }, 403);
    if (row.status === 'declined') return c.json({ ok: true, booking: row });
    if (row.status === 'confirmed' || row.status === 'cancelled') return c.json({ error: `Cannot decline a ${row.status} booking` }, 409);
    const upd = await c.env.DB.prepare(
      "UPDATE bookings SET status = 'declined' WHERE id = ? AND status = 'pending'"
    ).bind(id).run();
    if (!upd.meta || upd.meta.changes !== 1) {
      const fresh = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
      return c.json({ error: 'Booking state changed; refresh and retry', booking: fresh }, 409);
    }
    const updated = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    await audit(c.env, auth.wallet, 'booking.declined', 'booking', id, { reason: reason.slice(0, 200) });
    return c.json({ ok: true, booking: updated });
  });

  // -------- enrollments --------

  app.get('/api/enrollments/:wallet', async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.req.param('wallet'));
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    const { results } = await c.env.DB.prepare(`
      SELECT e.*, c.title AS course_title, c.slug AS course_slug
      FROM enrollments e LEFT JOIN courses c ON c.id = e.course_id
      WHERE e.student_wallet = ? ORDER BY e.enrolled_at DESC LIMIT 200
    `).bind(wallet).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  app.post('/api/enrollments', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    if (!body.course_id) return c.json({ error: 'course_id required' }, 400);
    try {
      await c.env.DB.prepare(`
        INSERT INTO enrollments (course_id, student_wallet, progress)
        VALUES (?, ?, ?)
      `).bind(Number(body.course_id), auth.wallet, Number(body.progress || 0)).run();
      return c.json({ ok: true });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Already enrolled' }, 409);
      throw e;
    }
  });

  // -------- public certificate gallery --------
  // GET /api/certificates/:wallet — public, no auth.
  // Returns one card per enrollment joined with the course it belongs to.
  // The on-chain certificate tx hash lives on the TokenomicCertificate
  // contract (not in D1); the frontend uses revenue_tx as a proof anchor.
  app.get('/api/certificates/:wallet', async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.req.param('wallet'));
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    const { results: enrollments } = await c.env.DB.prepare(`
      SELECT e.id, e.course_id, e.progress, e.enrolled_at,
             c.title AS course_title, c.slug AS course_slug,
             c.thumbnail_url AS course_thumb, c.educator_wallet,
             c.price_usdc, c.category, c.level
      FROM enrollments e LEFT JOIN courses c ON c.id = e.course_id
      WHERE e.student_wallet = ? ORDER BY e.enrolled_at DESC LIMIT 200
    `).bind(wallet).all();
    // revenue_tx has no course_id column today; we surface the most recent
    // tx hash involving this wallet as a generic "on-chain proof" anchor
    // each card can link to. When the schema gains a course_id link, fold
    // the lookup back into a per-course join.
    let lastTx = null;
    try {
      const r2 = await c.env.DB.prepare(`
        SELECT tx_hash, created_at FROM revenue_tx
        WHERE recipient_wallet = ? OR sender_wallet = ?
        ORDER BY created_at DESC LIMIT 1
      `).bind(wallet, wallet).first();
      if (r2 && r2.tx_hash) lastTx = r2.tx_hash;
    } catch (_) {}
    const items = (enrollments || []).map(e => ({
      ...e,
      claimed: Number(e.progress) >= 100,
      tx_hash: Number(e.progress) >= 100 ? lastTx : null
    }));
    return c.json({ wallet, items, count: items.length });
  });

  // -------- messages (community discussion) --------

  app.get('/api/messages/:communityId', async (c) => {
    const r = dbReady(c); if (r) return r;
    const id = Number(c.req.param('communityId'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid communityId' }, 400);
    const { results } = await c.env.DB.prepare(`
      SELECT m.*, p.display_name, p.avatar_url
      FROM messages m LEFT JOIN profiles p ON p.wallet_address = m.author_wallet
      WHERE m.community_id = ? ORDER BY m.created_at DESC LIMIT 100
    `).bind(id).all();
    return c.json({ items: (results || []).reverse(), count: (results || []).length });
  });

  app.post('/api/messages', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const cid = Number(body.community_id);
    const text = (body.body || '').slice(0, 2000);
    if (!Number.isFinite(cid) || cid <= 0) return c.json({ error: 'Invalid community_id' }, 400);
    if (text.length < 1) return c.json({ error: 'Message body required' }, 400);
    const res = await c.env.DB.prepare(
      'INSERT INTO messages (community_id, author_wallet, body) VALUES (?, ?, ?)'
    ).bind(cid, auth.wallet, text).run();
    const id = res.meta && res.meta.last_row_id;
    const row = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
    return c.json({ ok: true, message: row });
  });

  // -------- community feed (slug-based) --------
  // Convenience wrappers around the messages table, addressed by community
  // slug for friendly URLs (CommunityProfile island consumes these).

  async function resolveCommunityIdBySlug(env, slug) {
    if (!isValidSlug(slug)) return null;
    const row = await env.DB.prepare('SELECT id FROM communities WHERE slug = ?').bind(slug).first();
    return row ? Number(row.id) : null;
  }

  app.get('/api/communities/:slug/feed', async (c) => {
    const r = dbReady(c); if (r) return r;
    const slug = c.req.param('slug');
    const cid = await resolveCommunityIdBySlug(c.env, slug);
    if (!cid) return c.json({ error: 'Community not found' }, 404);
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
    const before = Number(c.req.query('before')) || 0;
    const sql = before > 0
      ? `SELECT m.*, p.display_name, p.avatar_url
         FROM messages m LEFT JOIN profiles p ON p.wallet_address = m.author_wallet
         WHERE m.community_id = ? AND m.id < ?
         ORDER BY m.id DESC LIMIT ?`
      : `SELECT m.*, p.display_name, p.avatar_url
         FROM messages m LEFT JOIN profiles p ON p.wallet_address = m.author_wallet
         WHERE m.community_id = ?
         ORDER BY m.id DESC LIMIT ?`;
    const stmt = before > 0
      ? c.env.DB.prepare(sql).bind(cid, before, limit)
      : c.env.DB.prepare(sql).bind(cid, limit);
    const { results } = await stmt.all();
    const items = (results || []).reverse();
    return c.json({
      community_id: cid,
      items,
      count: items.length,
      next_cursor: items.length === limit ? items[0].id : null,
    });
  });

  app.post('/api/communities/:slug/posts', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const slug = c.req.param('slug');
    const cid = await resolveCommunityIdBySlug(c.env, slug);
    if (!cid) return c.json({ error: 'Community not found' }, 404);
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const text = (body.body || body.text || '').toString().slice(0, 4000);
    if (text.trim().length < 1) return c.json({ error: 'Post body required' }, 400);
    // Membership gate: writers must either own the community or be a row in
    // community_members. Read-only viewers are intentionally not blocked
    // from GET /feed (public communities surface their feed to everyone).
    const owner = await c.env.DB.prepare(
      'SELECT educator_wallet FROM communities WHERE id = ?'
    ).bind(cid).first();
    let allowed = owner && lc(owner.educator_wallet) === auth.wallet;
    if (!allowed) {
      const member = await c.env.DB.prepare(
        'SELECT 1 FROM community_members WHERE community_id = ? AND wallet = ?'
      ).bind(cid, auth.wallet).first().catch(() => null);
      allowed = !!member;
    }
    if (!allowed) return c.json({ error: 'Join the community to post' }, 403);

    const ins = await c.env.DB.prepare(
      'INSERT INTO messages (community_id, author_wallet, body) VALUES (?, ?, ?)'
    ).bind(cid, auth.wallet, text).run();
    const id = ins.meta && ins.meta.last_row_id;
    const row = await c.env.DB.prepare(`
      SELECT m.*, p.display_name, p.avatar_url
      FROM messages m LEFT JOIN profiles p ON p.wallet_address = m.author_wallet
      WHERE m.id = ?
    `).bind(id).first();
    return c.json({ ok: true, post: row }, 201);
  });

  // ========================================================================
  // events — first-party event hosting (replaces the Luma proxy).
  // ========================================================================

  // Helpers (scoped to mountD1Routes so they share `c`-bound utilities).
  function isIsoDateString(s) {
    if (typeof s !== 'string' || s.length < 10 || s.length > 40) return false;
    const t = Date.parse(s);
    return Number.isFinite(t);
  }
  function slugify(s) {
    return String(s || '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }
  async function uniqueEventSlug(env, base) {
    const baseSlug = base || ('event-' + Math.random().toString(36).slice(2, 8));
    let slug = baseSlug;
    for (let i = 0; i < 6; i++) {
      const hit = await env.DB.prepare('SELECT 1 FROM events WHERE slug = ?').bind(slug).first();
      if (!hit) return slug;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return `${baseSlug}-${Date.now().toString(36)}`;
  }
  async function loadEventAsHost(c, idOrSlug) {
    const auth = await requireAuth(c); if (auth.error) return { fail: auth.error };
    const ev = await loadEventByIdOrSlug(c.env, idOrSlug);
    if (!ev) return { fail: c.json({ error: 'Event not found' }, 404) };
    if (lc(ev.host_wallet) === auth.wallet) return { auth, event: ev };
    if (await isAdminWallet(c.env, auth.wallet)) return { auth, event: ev };
    return { fail: c.json({ error: 'Not your event' }, 403) };
  }
  async function loadEventByIdOrSlug(env, idOrSlug) {
    const idNum = Number(idOrSlug);
    if (Number.isFinite(idNum) && idNum > 0) {
      return await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(idNum).first();
    }
    if (!isValidSlug(idOrSlug)) return null;
    return await env.DB.prepare('SELECT * FROM events WHERE slug = ?').bind(String(idOrSlug)).first();
  }
  // Atomic: rsvp_count = number of 'going' rsvps for this event.
  async function refreshRsvpCount(env, eventId) {
    await env.DB.prepare(
      "UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM event_rsvps WHERE event_id = ? AND status = 'going') WHERE id = ?"
    ).bind(eventId, eventId).run();
  }
  // Promote oldest waitlisted RSVPs to 'going' until capacity is filled or
  // the waitlist is empty. Loops to avoid leaving free seats unfilled when
  // multiple cancels race with promotions.
  async function maybePromoteWaitlist(env, eventId) {
    const promoted = [];
    for (let i = 0; i < 100; i++) {
      const ev = await env.DB.prepare('SELECT id, capacity, rsvp_count FROM events WHERE id = ?').bind(eventId).first();
      if (!ev || ev.capacity == null) break;
      if ((ev.rsvp_count || 0) >= ev.capacity) break;
      const next = await env.DB.prepare(
        "SELECT id FROM event_rsvps WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at ASC, id ASC LIMIT 1"
      ).bind(eventId).first();
      if (!next) break;
      const upd = await env.DB.prepare(
        "UPDATE event_rsvps SET status = 'going', updated_at = datetime('now') WHERE id = ? AND status = 'waitlist'"
      ).bind(next.id).run();
      if (!upd.meta || upd.meta.changes !== 1) {
        // Lost the race for this waitlister to another concurrent promotion;
        // skip and try the next one rather than leaving free seats unfilled.
        continue;
      }
      await refreshRsvpCount(env, eventId);
      promoted.push(next.id);
    }
    return promoted;
  }

  // Check if a wallet has admin role (env ADMIN_WALLETS or profiles.roles JSON).
  async function isAdminWallet(env, wallet) {
    if (!wallet) return false;
    const adminEnv = (env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (adminEnv.includes(wallet)) return true;
    const p = await env.DB.prepare('SELECT roles FROM profiles WHERE wallet_address = ?').bind(wallet).first();
    const parsed = p ? jsonOrNull(p.roles) : null;
    return Array.isArray(parsed) && parsed.includes('admin');
  }

  // Public list. Filters: host, community, status, from, to, q, visibility, limit.
  // Defaults to public + scheduled, sorted by starts_at ASC.
  app.get('/api/events', async (c) => {
    const r = dbReady(c); if (r) return r;
    const url = new URL(c.req.url);
    const where = [];
    const binds = [];
    const visibility = url.searchParams.get('visibility') || 'public';
    if (!['public', 'unlisted', 'private', 'any'].includes(visibility)) {
      return c.json({ error: 'Bad visibility' }, 400);
    }
    const host = url.searchParams.get('host');
    if (host && !isHexAddress(host)) return c.json({ error: 'Bad host' }, 400);

    // Privacy gate: anything beyond 'public' requires either auth + own scope, or admin.
    if (visibility !== 'public') {
      const auth = await requireAuth(c); if (auth.error) return auth.error;
      const isAdmin = await isAdminWallet(c.env, auth.wallet);
      if (!isAdmin) {
        // Non-admins may only request non-public lists scoped to their own wallet.
        if (!host || lc(host) !== auth.wallet) {
          return c.json({ error: 'Forbidden: non-public listings must be scoped to host=<your wallet>' }, 403);
        }
      }
    }
    if (visibility !== 'any') { where.push('visibility = ?'); binds.push(visibility); }
    if (host) { where.push('host_wallet = ?'); binds.push(lc(host)); }
    const community = url.searchParams.get('community');
    if (community) {
      const cid = Number(community);
      if (!Number.isFinite(cid) || cid <= 0) return c.json({ error: 'Bad community' }, 400);
      where.push('community_id = ?'); binds.push(cid);
    }
    const status = url.searchParams.get('status');
    if (status) {
      if (!['scheduled', 'cancelled'].includes(status)) return c.json({ error: 'Bad status' }, 400);
      where.push('status = ?'); binds.push(status);
    } else {
      where.push("status = 'scheduled'");
    }
    const from = url.searchParams.get('from');
    if (from) {
      if (!isIsoDateString(from)) return c.json({ error: 'Bad from' }, 400);
      where.push('starts_at >= ?'); binds.push(from);
    }
    const to = url.searchParams.get('to');
    if (to) {
      if (!isIsoDateString(to)) return c.json({ error: 'Bad to' }, 400);
      where.push('starts_at <= ?'); binds.push(to);
    }
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      where.push('(title LIKE ? OR description LIKE ?)');
      const like = '%' + q.slice(0, 80).replace(/[%_]/g, ' ') + '%';
      binds.push(like, like);
    }
    let limit = Number(url.searchParams.get('limit') || 100);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 500) limit = 500;
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY starts_at ASC LIMIT ${limit}`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  // List the caller's own RSVPs. MUST be registered before /api/events/:idOrSlug
  // so "me" isn't matched as an event slug.
  app.get('/api/events/me/rsvps', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const { results } = await c.env.DB.prepare(`
      SELECT r.id AS rsvp_id, r.status AS rsvp_status, r.created_at AS rsvp_created_at,
             e.*
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      WHERE r.wallet = ? AND r.status != 'cancelled'
      ORDER BY e.starts_at ASC
      LIMIT 200
    `).bind(auth.wallet).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  // GET single event by id or slug. If a Bearer token is present, also returns my_rsvp.
  // Visibility rules:
  //   public   → anyone may read
  //   unlisted → unguessable by slug; we still serve to anyone with the link
  //   private  → only host, admin, or an existing (non-cancelled) RSVPer may read
  app.get('/api/events/:idOrSlug', async (c) => {
    const r = dbReady(c); if (r) return r;
    const ev = await loadEventByIdOrSlug(c.env, c.req.param('idOrSlug'));
    if (!ev) return c.json({ error: 'Event not found' }, 404);
    let my_rsvp = null;
    let authedWallet = null;
    const hasAuth = (c.req.header('authorization') || '').startsWith('Bearer ');
    if (hasAuth) {
      const auth = await requireAuth(c);
      if (!auth.error) {
        authedWallet = auth.wallet;
        my_rsvp = await c.env.DB.prepare(
          'SELECT id, status, created_at FROM event_rsvps WHERE event_id = ? AND wallet = ?'
        ).bind(ev.id, auth.wallet).first();
      }
    }
    if (ev.visibility === 'private' || ev.visibility === 'unlisted') {
      const isHost = authedWallet && lc(ev.host_wallet) === authedWallet;
      const isAdmin = authedWallet && await isAdminWallet(c.env, authedWallet);
      const isInvited = my_rsvp && my_rsvp.status !== 'cancelled';
      if (ev.visibility === 'private') {
        if (!isHost && !isAdmin && !isInvited) {
          // 404 (not 403) so we don't confirm the event exists.
          return c.json({ error: 'Event not found' }, 404);
        }
      } else {
        // unlisted: link-only. Allow access when fetched by slug; reject
        // numeric-ID enumeration unless the caller is host/admin/invited.
        const param = String(c.req.param('idOrSlug'));
        const fetchedBySlug = !/^\d+$/.test(param) && param === ev.slug;
        if (!fetchedBySlug && !isHost && !isAdmin && !isInvited) {
          return c.json({ error: 'Event not found' }, 404);
        }
      }
    }
    return c.json({ event: ev, my_rsvp });
  });

  // Create an event. Caller becomes the host.
  app.post('/api/events', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const title = (body.title || '').toString().trim();
    if (title.length < 2 || title.length > 200) return c.json({ error: 'title 2..200 chars' }, 400);
    if (!isIsoDateString(body.starts_at)) return c.json({ error: 'starts_at must be ISO datetime' }, 400);
    if (body.ends_at != null && !isIsoDateString(body.ends_at)) return c.json({ error: 'ends_at must be ISO datetime' }, 400);
    if (body.ends_at && Date.parse(body.ends_at) <= Date.parse(body.starts_at)) {
      return c.json({ error: 'ends_at must be after starts_at' }, 400);
    }
    const description = (body.description || '').toString().slice(0, 50000);
    const timezone = (body.timezone || 'UTC').toString().slice(0, 64);
    const location = (body.location || '').toString().slice(0, 300);
    const meeting_url = (body.meeting_url || '').toString().slice(0, 500);
    const cover_url = (body.cover_url || '').toString().slice(0, 500);
    const visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'public';
    let capacity = null;
    if (body.capacity !== undefined && body.capacity !== null && body.capacity !== '') {
      const n = Number(body.capacity);
      if (!Number.isFinite(n) || n < 1 || n > 100000) return c.json({ error: 'capacity 1..100000' }, 400);
      capacity = Math.floor(n);
    }
    let community_id = null;
    if (body.community_id != null && body.community_id !== '') {
      const cid = Number(body.community_id);
      if (!Number.isFinite(cid) || cid <= 0) return c.json({ error: 'Bad community_id' }, 400);
      const exists = await c.env.DB.prepare('SELECT 1 FROM communities WHERE id = ?').bind(cid).first();
      if (!exists) return c.json({ error: 'community_id not found' }, 400);
      community_id = cid;
    }
    // Resolve host display name from profile (best-effort).
    const profile = await c.env.DB.prepare('SELECT display_name FROM profiles WHERE wallet_address = ?').bind(auth.wallet).first();
    const host_name = (body.host_name || (profile && profile.display_name) || '').toString().slice(0, 100);
    const slug = await uniqueEventSlug(c.env, slugify(body.slug || title));
    const res = await c.env.DB.prepare(`
      INSERT INTO events (slug, host_wallet, host_name, title, description, starts_at, ends_at,
                          timezone, location, meeting_url, cover_url, capacity, status, visibility, community_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
    `).bind(
      slug, auth.wallet, host_name, title, description, body.starts_at, body.ends_at || null,
      timezone, location || null, meeting_url || null, cover_url || null, capacity, visibility, community_id
    ).run();
    const id = res.meta && res.meta.last_row_id;
    const row = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    await audit(c.env, auth.wallet, 'event.created', 'event', id, { title });
    return c.json({ ok: true, event: row });
  });

  // Update an event (host or admin).
  app.patch('/api/events/:id', async (c) => {
    const r = dbReady(c); if (r) return r;
    const gate = await loadEventAsHost(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    const ev = gate.event;
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const sets = [], binds = [];
    function setStr(field, max) {
      if (typeof body[field] === 'string') {
        const v = body[field].trim().slice(0, max);
        sets.push(`${field} = ?`); binds.push(v || null);
      }
    }
    if (typeof body.title === 'string') {
      const t = body.title.trim();
      if (t.length < 2 || t.length > 200) return c.json({ error: 'title 2..200 chars' }, 400);
      sets.push('title = ?'); binds.push(t);
    }
    if (typeof body.description === 'string') {
      sets.push('description = ?'); binds.push(body.description.slice(0, 50000));
    }
    if (body.starts_at !== undefined) {
      if (!isIsoDateString(body.starts_at)) return c.json({ error: 'Bad starts_at' }, 400);
      sets.push('starts_at = ?'); binds.push(body.starts_at);
    }
    if (body.ends_at !== undefined) {
      if (body.ends_at && !isIsoDateString(body.ends_at)) return c.json({ error: 'Bad ends_at' }, 400);
      sets.push('ends_at = ?'); binds.push(body.ends_at || null);
    }
    setStr('timezone', 64);
    setStr('location', 300);
    setStr('meeting_url', 500);
    setStr('cover_url', 500);
    setStr('host_name', 100);
    if (body.visibility !== undefined) {
      if (!['public', 'unlisted', 'private'].includes(body.visibility)) return c.json({ error: 'Bad visibility' }, 400);
      sets.push('visibility = ?'); binds.push(body.visibility);
    }
    if (body.status !== undefined) {
      if (!['scheduled', 'cancelled'].includes(body.status)) return c.json({ error: 'Bad status' }, 400);
      sets.push('status = ?'); binds.push(body.status);
    }
    if (body.capacity !== undefined) {
      if (body.capacity === null || body.capacity === '') {
        sets.push('capacity = ?'); binds.push(null);
      } else {
        const n = Number(body.capacity);
        if (!Number.isFinite(n) || n < 1 || n > 100000) return c.json({ error: 'capacity 1..100000' }, 400);
        sets.push('capacity = ?'); binds.push(Math.floor(n));
      }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now')");
    binds.push(ev.id);
    await c.env.DB.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    // If capacity grew, promote waitlisted attendees.
    if (body.capacity !== undefined) await maybePromoteWaitlist(c.env, ev.id);
    const row = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(ev.id).first();
    await audit(c.env, gate.auth.wallet, 'event.updated', 'event', ev.id);
    return c.json({ ok: true, event: row });
  });

  // Delete an event (host or admin). Cascades RSVPs.
  app.delete('/api/events/:id', async (c) => {
    const r = dbReady(c); if (r) return r;
    const gate = await loadEventAsHost(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    await c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(gate.event.id).run();
    await audit(c.env, gate.auth.wallet, 'event.deleted', 'event', gate.event.id);
    return c.json({ ok: true });
  });

  // RSVP create/upsert. Honors capacity → waitlist. If caller previously
  // cancelled, this restores them (back to going/waitlist as appropriate).
  app.post('/api/events/:id/rsvp', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const ev = await loadEventByIdOrSlug(c.env, c.req.param('id'));
    if (!ev) return c.json({ error: 'Event not found' }, 404);
    if (ev.status === 'cancelled') return c.json({ error: 'Event is cancelled' }, 409);
    if (ev.visibility === 'private') return c.json({ error: 'Private event' }, 403);
    let body = {}; try { body = await c.req.json(); } catch {}
    const name = ((body && body.name) || '').toString().slice(0, 100);
    const email = ((body && body.email) || '').toString().slice(0, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Bad email' }, 400);

    // Race-safe insert: derive status from the LIVE COUNT of going RSVPs at
    // insert time using a single SQL statement. D1 serializes writes, so two
    // concurrent INSERTs cannot both pass the capacity check when one seat
    // remains — the second one's COUNT() includes the first row.
    try {
      await c.env.DB.prepare(`
        INSERT INTO event_rsvps (event_id, wallet, name, email, status)
        SELECT ?, ?, ?, ?,
          CASE
            WHEN e.capacity IS NULL THEN 'going'
            WHEN (SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'going') < e.capacity THEN 'going'
            ELSE 'waitlist'
          END
        FROM events e WHERE e.id = ?
      `).bind(ev.id, auth.wallet, name || null, email || null, ev.id).run();
    } catch (e) {
      // UNIQUE(event_id, wallet) → restore/update existing row.
      const existing = await c.env.DB.prepare('SELECT * FROM event_rsvps WHERE event_id = ? AND wallet = ?').bind(ev.id, auth.wallet).first();
      if (!existing) return c.json({ error: 'RSVP failed: ' + e.message }, 500);
      if (existing.status === 'cancelled') {
        // Revive with same atomic capacity-aware logic.
        await c.env.DB.prepare(`
          UPDATE event_rsvps
          SET status = CASE
                WHEN (SELECT capacity FROM events WHERE id = ?) IS NULL THEN 'going'
                WHEN (SELECT COUNT(*) FROM event_rsvps WHERE event_id = ? AND status = 'going') < (SELECT capacity FROM events WHERE id = ?) THEN 'going'
                ELSE 'waitlist'
              END,
              name = COALESCE(NULLIF(?, ''), name),
              email = COALESCE(NULLIF(?, ''), email),
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(ev.id, ev.id, ev.id, name, email, existing.id).run();
      } else {
        // Already going or waitlisted — just update name/email, leave status alone.
        await c.env.DB.prepare(
          "UPDATE event_rsvps SET name = COALESCE(NULLIF(?, ''), name), email = COALESCE(NULLIF(?, ''), email), updated_at = datetime('now') WHERE id = ?"
        ).bind(name, email, existing.id).run();
      }
    }
    await refreshRsvpCount(c.env, ev.id);
    const fresh = await c.env.DB.prepare('SELECT * FROM event_rsvps WHERE event_id = ? AND wallet = ?').bind(ev.id, auth.wallet).first();
    const liveEvent = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(ev.id).first();
    await audit(c.env, auth.wallet, 'event.rsvp.' + (fresh ? fresh.status : 'unknown'), 'event', ev.id);
    return c.json({ ok: true, rsvp: fresh, event: liveEvent });
  });

  // Cancel my RSVP. Promotes the next waitlister if capacity opens up.
  app.delete('/api/events/:id/rsvp', async (c) => {
    const r = dbReady(c); if (r) return r;
    const auth = await requireAuth(c); if (auth.error) return auth.error;
    const ev = await loadEventByIdOrSlug(c.env, c.req.param('id'));
    if (!ev) return c.json({ error: 'Event not found' }, 404);
    const existing = await c.env.DB.prepare('SELECT * FROM event_rsvps WHERE event_id = ? AND wallet = ?').bind(ev.id, auth.wallet).first();
    if (!existing) return c.json({ ok: true, rsvp: null });
    if (existing.status === 'cancelled') return c.json({ ok: true, rsvp: existing });
    await c.env.DB.prepare(
      "UPDATE event_rsvps SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?"
    ).bind(existing.id).run();
    await refreshRsvpCount(c.env, ev.id);
    await maybePromoteWaitlist(c.env, ev.id);
    const fresh = await c.env.DB.prepare('SELECT * FROM event_rsvps WHERE id = ?').bind(existing.id).first();
    await audit(c.env, auth.wallet, 'event.rsvp.cancel', 'event', ev.id);
    return c.json({ ok: true, rsvp: fresh });
  });

  // Host-only: list attendees of an event.
  app.get('/api/events/:id/rsvps', async (c) => {
    const r = dbReady(c); if (r) return r;
    const gate = await loadEventAsHost(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status');
    let sql = 'SELECT * FROM event_rsvps WHERE event_id = ?';
    const binds = [gate.event.id];
    if (status) {
      if (!['going', 'waitlist', 'cancelled'].includes(status)) return c.json({ error: 'Bad status' }, 400);
      sql += ' AND status = ?'; binds.push(status);
    }
    sql += ' ORDER BY created_at ASC LIMIT 1000';
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  // Caller's own RSVPs (with joined event info).
}
