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
  if (!token) return { error: c.json({ error: 'Missing Bearer token' }, 401) };
  const secret = c.env.JWT_SECRET;
  if (!secret) return { error: c.json({ error: 'JWT_SECRET not configured on worker' }, 503) };
  const payload = await verifyJwt(token, secret);
  if (!payload || !isHexAddress(payload.wallet)) {
    return { error: c.json({ error: 'Invalid or expired token' }, 401) };
  }
  return { wallet: lc(payload.wallet), exp: payload.exp };
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
    const sql = `SELECT * FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC, created_at DESC LIMIT 200`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ items: results || [], count: (results || []).length });
  });

  app.get('/api/articles/:slug', async (c) => {
    const r = dbReady(c); if (r) return r;
    const slug = c.req.param('slug');
    if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM articles WHERE slug = ?').bind(slug).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
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
}
