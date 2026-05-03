/**
 * Phase 6 — Content infrastructure routes.
 *
 *   Cloudflare Stream
 *     POST /api/content/stream/upload-url        owner-gated direct creator URL
 *     POST /api/content/stream/webhook           CF Stream webhook (HMAC-verified)
 *     GET  /api/content/lessons/:moduleId/playback   enrollment-gated signed playback
 *
 *   Cloudflare R2
 *     POST /api/content/r2/put                   small inline upload (multipart proxy)
 *     GET  /api/content/r2/get                   signed GET (?key=&t=&exp=&sig=)
 *
 *   Cloudflare Images
 *     POST /api/content/images/direct-upload     one-time creator upload URL
 *     POST /api/content/images/persist           record a delivered image_id in D1
 *
 *   Profile / course assets
 *     POST /api/profile/avatar                   educator avatar → R2/Images
 *     POST /api/courses/:id/thumbnail            course thumbnail → CF Images
 *     POST /api/articles/:id/cover               article cover → CF Images
 *
 *   Certificates (Phase 6 wire-up)
 *     POST /api/courses/:id/issue-certificate    enrollment_id → R2 PDF + email
 *
 * Every binding is feature-detected; missing CF_ACCOUNT_ID / R2_BUCKET /
 * CF_IMAGES_TOKEN return a clean 503 instead of crashing the worker. This
 * lets the local Express dev server keep booting without secrets configured.
 */

import { sendEmail, logEmail, tplEnrollmentConfirmation, tplCertificateIssued, tplCoursePublished } from './mail.js';
import { readSessionFromCookie } from './siwe.js';

// ─────────────────────────────────────────── helpers

function jsonError(c, code, msg) { return c.json({ error: msg }, code); }
function nowIso() { return new Date().toISOString(); }
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
function isValidStreamUid(s) { return typeof s === 'string' && /^[a-f0-9]{20,64}$/i.test(s); }
function lc(s) { return (s || '').toString().toLowerCase(); }
function isHexAddr(s) { return typeof s === 'string' && /^0x[a-fA-F0-9]{40}$/.test(s); }

// Minimal HS256 verifier (matches the one in d1-routes.js so JWTs cut by
// /api/auth/login are accepted here without crossing module boundaries).
async function verifyJwtHS256(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [h, p, s] = parts;
    const data = `${h}.${p}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + (4 - s.length % 4) % 4, '=')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(data));
    if (!ok) return null;
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(p.length + (4 - p.length % 4) % 4, '=')));
    if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
  } catch { return null; }
}

async function requireAuthLocal(c) {
  // Mirror d1-routes.requireAuth semantics exactly: Bearer is authoritative
  // (when present, an invalid token is a 401, not a fall-through to cookie),
  // and a missing JWT_SECRET surfaces as a clear 503 instead of silently
  // denying valid Bearers. Cookie session is only consulted when no Bearer
  // header is supplied.
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    if (!c.env.JWT_SECRET) {
      return { error: jsonError(c, 503, 'JWT_SECRET not configured on worker') };
    }
    const payload = await verifyJwtHS256(token, c.env.JWT_SECRET);
    if (!payload || !isHexAddr(payload.wallet)) {
      return { error: jsonError(c, 401, 'Invalid or expired token') };
    }
    return { wallet: lc(payload.wallet), session: payload };
  }
  try {
    const sess = await readSessionFromCookie(c);
    if (sess && isHexAddr(sess.address)) return { wallet: lc(sess.address), session: sess };
  } catch (_) {}
  return { error: jsonError(c, 401, 'Authentication required (Bearer token or SIWE cookie)') };
}

// Safe base64 → Uint8Array. Returns null on malformed input so callers can
// 400 the request instead of crashing the worker with a Subtle decode error.
function safeB64ToBytes(b64) {
  try {
    const s = String(b64 || '').replace(/\s+/g, '');
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

async function isAdmin(env, wallet) {
  const adminEnv = (env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (adminEnv.includes(lc(wallet))) return true;
  if (!env.DB) return false;
  const p = await env.DB.prepare('SELECT roles FROM profiles WHERE wallet_address = ?').bind(lc(wallet)).first();
  const roles = p && safeJson(p.roles);
  return Array.isArray(roles) && roles.includes('admin');
}

async function loadCourseOwned(c, courseId) {
  const auth = await requireAuthLocal(c);
  if (auth.error) return { fail: auth.error };
  if (!c.env.DB) return { fail: jsonError(c, 503, 'Database not configured') };
  const id = Number(courseId);
  if (!Number.isFinite(id) || id <= 0) return { fail: jsonError(c, 400, 'Bad course id') };
  const course = await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first();
  if (!course) return { fail: jsonError(c, 404, 'Course not found') };
  if (lc(course.educator_wallet) === auth.wallet) return { auth, course };
  if (await isAdmin(c.env, auth.wallet)) return { auth, course };
  return { fail: jsonError(c, 403, 'Not your course') };
}

// ─────────────────────────────────────────── Cloudflare API plumbing

async function callCfApi(env, path, init = {}) {
  if (!env.CF_ACCOUNT_ID || (!env.CF_STREAM_TOKEN && !env.CF_IMAGES_TOKEN && !env.CF_API_TOKEN)) {
    return { ok: false, status: 503, error: 'Cloudflare API not configured' };
  }
  const token = env.CF_API_TOKEN || env.CF_STREAM_TOKEN || env.CF_IMAGES_TOKEN;
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(init.headers || {}),
  };
  if (!(init.body instanceof FormData) && !headers['Content-Type'] && init.body) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, { ...init, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data || data.success === false) {
    const msg = (data && data.errors && data.errors[0] && data.errors[0].message) || `CF API ${resp.status}`;
    return { ok: false, status: resp.status || 502, error: msg };
  }
  return { ok: true, data };
}

// ─────────────────────────────────────────── HMAC signed-URL helpers

async function hmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function b64url(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signR2Get(env, key, exp) {
  const secret = env.R2_URL_SIGNING_KEY || env.SIWE_SECRET || env.JWT_SECRET || '';
  if (!secret) return null;
  const k = await hmacKey(secret);
  const payload = `${key}|${exp}`;
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload));
  return b64url(sig);
}

async function verifyR2Get(env, key, exp, sig) {
  const secret = env.R2_URL_SIGNING_KEY || env.SIWE_SECRET || env.JWT_SECRET || '';
  if (!secret || !key || !exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = await signR2Get(env, key, exp);
  if (!expected) return false;
  // Constant-time compare
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ─────────────────────────────────────────── On-chain CourseAccess1155.balanceOf

const COURSE_ACCESS_ABI = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }],
  outputs: [{ type: 'uint256' }],
}];

async function viemClientForCourse(env) {
  const { createPublicClient, http } = await import('viem');
  const chains = await import('viem/chains');
  const id = Number(env.COURSE_ACCESS_CHAIN_ID || env.SUBSCRIPTION_CHAIN_ID || 8453);
  const chain = id === 84532 ? chains.baseSepolia : chains.base;
  const rpc = id === 84532
    ? (env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
    : (env.BASE_RPC_URL || 'https://mainnet.base.org');
  return createPublicClient({ chain, transport: http(rpc) });
}

async function hasOnChainAccess(env, wallet, onChainCourseId) {
  if (!env.COURSE_ACCESS_1155 || !isHexAddr(env.COURSE_ACCESS_1155)) return null; // unknown
  if (onChainCourseId == null) return null;
  try {
    const client = await viemClientForCourse(env);
    const bal = await client.readContract({
      address:      env.COURSE_ACCESS_1155,
      abi:          COURSE_ACCESS_ABI,
      functionName: 'balanceOf',
      args:         [wallet, BigInt(onChainCourseId)],
    });
    return BigInt(bal) > 0n;
  } catch (e) {
    console.warn('balanceOf failed:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────── PDF generation (minimal, dep-free)

/**
 * Tiny one-page PDF builder. Uses the built-in Helvetica font (Type1
 * standard 14, no embedding required). Keeps the worker bundle small —
 * pdf-lib would add ~200kB. The output validates in Acrobat / browser
 * built-in viewers.
 */
function buildCertificatePdf({ learnerName, courseTitle, educatorName, dateStr, txHash }) {
  function escPdf(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  const safeLearner   = escPdf(learnerName   || 'Tokenomic Learner');
  const safeCourse    = escPdf(courseTitle   || 'Tokenomic Course');
  const safeEducator  = escPdf(educatorName  || 'Tokenomic Educator');
  const safeDate      = escPdf(dateStr       || new Date().toISOString().slice(0,10));
  const safeTx        = escPdf(txHash ? `Mint: ${txHash}` : '');

  // Page is US-letter landscape (792 x 612).
  const stream =
`q
0.04 0.06 0.10 rg
0 0 792 612 re f
1 1 1 rg
40 40 712 532 re f
0.97 0.4 0 rg
40 540 712 32 re f
Q
BT
/F1 28 Tf
1 0 0 1 60 510 Tm
0 0 0 rg
(CERTIFICATE OF COMPLETION) Tj
ET
BT
/F1 14 Tf
1 0 0 1 60 470 Tm
0.35 0.51 0.6 rg
(Tokenomic - On-chain learning on Base) Tj
ET
BT
/F2 18 Tf
1 0 0 1 60 380 Tm
0 0 0 rg
(This is to certify that) Tj
ET
BT
/F1 32 Tf
1 0 0 1 60 330 Tm
0 0 0 rg
(${safeLearner}) Tj
ET
BT
/F2 18 Tf
1 0 0 1 60 280 Tm
0 0 0 rg
(has successfully completed the course:) Tj
ET
BT
/F1 24 Tf
1 0 0 1 60 230 Tm
0.97 0.4 0 rg
(${safeCourse}) Tj
ET
BT
/F2 14 Tf
1 0 0 1 60 160 Tm
0.35 0.51 0.6 rg
(Issued by ${safeEducator} on ${safeDate}) Tj
ET
BT
/F2 10 Tf
1 0 0 1 60 130 Tm
0.45 0.51 0.55 rg
(${safeTx}) Tj
ET`;

  const objects = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`);
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);

  let pdf = `%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`;
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  // Convert to Uint8Array preserving byte values.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
  return bytes;
}

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────── R2 helpers

function r2Available(env) { return !!env.R2_BUCKET; }

async function r2Put(env, key, body, opts = {}) {
  if (!r2Available(env)) throw new Error('R2 bucket not bound');
  await env.R2_BUCKET.put(key, body, {
    httpMetadata: { contentType: opts.contentType || 'application/octet-stream' },
    customMetadata: opts.customMetadata || undefined,
  });
}

function buildSignedR2Url(c, key, ttlSec = 300) {
  // Default TTL is 5 minutes for protected assets. Avatar / public-ish
  // assets pass a longer ttl explicitly. Cap at 24h so a leaked URL
  // expires within a day even when callers ask for more.
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(ttlSec, 24 * 3600));
  return signR2Get(c.env, key, exp).then(sig => {
    if (!sig) return null;
    const base = new URL(c.req.url).origin;
    return `${base}/api/content/r2/get?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  });
}

// ─────────────────────────────────────────── route mount

export function mountContentRoutes(app) {

  // ────────────── Cloudflare Stream

  /**
   * Owner-gated direct creator URL. Replaces the previously anonymous
   * /stream/direct-upload (kept for backward compat, but we add a proper
   * authed endpoint that links the upload to the course/module).
   */
  app.post('/api/content/stream/upload-url', async (c) => {
    const auth = await requireAuthLocal(c);
    if (auth.error) return auth.error;
    let body = {};
    try { body = await c.req.json(); } catch {}
    // Accept both snake_case (worker convention) and camelCase (the
    // dashboard frontend convention) for backwards/forwards compat.
    const courseRaw = body.course_id != null ? body.course_id : body.courseId;
    const moduleRaw = body.module_id != null ? body.module_id : body.moduleId;
    const courseId = courseRaw != null ? Number(courseRaw) : null;
    const moduleId = moduleRaw != null ? Number(moduleRaw) : null;

    // Phase 6 hardening: this endpoint mints a paid Cloudflare Stream
    // direct-creator URL, so we MUST tie every issuance to a course
    // (or module → course) the caller owns. Refuse anonymous module-
    // less requests outright — otherwise any authenticated wallet
    // could mint upload URLs and burn the educator's Stream quota.
    if (!moduleId && !courseId) {
      return jsonError(c, 400, 'course_id or module_id is required (must own the target course).');
    }

    // Authorization: if a moduleId was supplied, resolve it to its
    // owning course and enforce that the caller is the educator (or
    // admin) for THAT course. Without this check, any authenticated
    // user could bind their Stream upload to another educator's
    // module — the webhook would then write modules.video_uid for a
    // module they do not own (IDOR).
    if (moduleId) {
      if (!c.env.DB) return jsonError(c, 503, 'Database not configured');
      const mrow = await c.env.DB.prepare('SELECT id, course_id FROM modules WHERE id = ?').bind(moduleId).first();
      if (!mrow) return jsonError(c, 404, 'Module not found');
      // The course gate enforces educator/admin ownership.
      const mGate = await loadCourseOwned(c, mrow.course_id);
      if (mGate.fail) return mGate.fail;
      // If both moduleId AND courseId were supplied, they must match.
      if (courseId && Number(courseId) !== Number(mrow.course_id)) {
        return jsonError(c, 400, 'moduleId does not belong to courseId');
      }
    }
    // If only a courseId is supplied, verify ownership directly.
    if (courseId && !moduleId) {
      const gate = await loadCourseOwned(c, courseId);
      if (gate.fail) return gate.fail;
    }
    const maxDuration = Math.min(
      parseInt(body.maxDurationSeconds || c.env.STREAM_MAX_DURATION_SECONDS || '21600', 10),
      21600
    );
    const meta = {
      name:         (body.name || 'tokenomic-lesson').toString().slice(0, 200),
      uploadedFrom: 'tokenomic-api',
      ownerWallet:  auth.wallet,
      courseId:     courseId || undefined,
      moduleId:     moduleId || undefined,
    };
    const allowedOrigins = (c.env.STREAM_ALLOWED_ORIGINS || c.env.ALLOWED_ORIGINS || '')
      .split(',').map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(s => s && !s.includes('*'));

    const r = await callCfApi(c.env, '/stream/direct_upload', {
      method: 'POST',
      body: JSON.stringify({
        maxDurationSeconds: maxDuration,
        creator:            auth.wallet,
        meta,
        // Phase 6: ALL course videos require signed playback.
        requireSignedURLs:  true,
        allowedOrigins:     allowedOrigins.length ? allowedOrigins : undefined,
      }),
    });
    if (!r.ok) return jsonError(c, r.status, r.error);

    const uid = r.data.result.uid;
    const uploadURL = r.data.result.uploadURL;

    // Persist the pending upload row.
    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO lesson_uploads (stream_uid, course_id, module_id, owner_wallet, state, meta)
          VALUES (?, ?, ?, ?, 'pending', ?)
        `).bind(uid, courseId, moduleId, auth.wallet, JSON.stringify(meta)).run();
      } catch (_) {}
    }
    return c.json({ ok: true, uid, uploadURL });
  });

  /**
   * Cloudflare Stream webhook. CF signs delivery with HMAC SHA-256 in the
   * `Webhook-Signature` header (`time=…,sig1=…`). We verify against
   * STREAM_WEBHOOK_SIGNING_SECRET; on success we update lesson_uploads
   * and, if a module was linked at creation time, set modules.video_uid.
   */
  app.post('/api/content/stream/webhook', async (c) => {
    const secret = c.env.STREAM_WEBHOOK_SIGNING_SECRET;
    const sigHdr = c.req.header('webhook-signature') || c.req.header('Webhook-Signature') || '';
    const raw = await c.req.text();
    // Phase 6: webhook signing is MANDATORY. Without the shared secret an
    // unauthenticated caller could mutate lesson_uploads/modules state by
    // replaying CF Stream payloads. Refusing the request is the safe default.
    if (!secret) return jsonError(c, 503, 'STREAM_WEBHOOK_SIGNING_SECRET not configured');
    // CF Stream signs as `time=<unix>,sig1=<hex>` but the order/casing of
    // segments isn't guaranteed by the spec — parse each comma-delimited
    // pair independently to stay tolerant of harmless reformatting.
    let ts = null, sig = null;
    for (const part of sigHdr.split(',')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim().toLowerCase();
      const v = part.slice(eq + 1).trim();
      if (k === 'time') ts = v;
      else if (k === 'sig1') sig = v.toLowerCase();
    }
    if (!ts || !sig || !/^\d+$/.test(ts) || !/^[a-f0-9]+$/.test(sig)) {
      return jsonError(c, 401, 'Bad signature header');
    }
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return jsonError(c, 401, 'Stale webhook');
    const k2 = await hmacKey(secret);
    const expected = await crypto.subtle.sign('HMAC', k2, new TextEncoder().encode(`${ts}.${raw}`));
    const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (expectedHex.length !== sig.length) return jsonError(c, 401, 'Bad signature');
    let diff = 0;
    for (let i = 0; i < expectedHex.length; i++) diff |= expectedHex.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return jsonError(c, 401, 'Bad signature');
    let payload = {}; try { payload = JSON.parse(raw); } catch {}
    const uid = payload && payload.uid;
    if (!isValidStreamUid(uid)) return c.json({ ok: true, ignored: true });
    const ready = !!payload.readyToStream || (payload.status && payload.status.state === 'ready');
    if (c.env.DB) {
      const row = await c.env.DB.prepare('SELECT * FROM lesson_uploads WHERE stream_uid = ?').bind(uid).first();
      if (row) {
        await c.env.DB.prepare(`
          UPDATE lesson_uploads
          SET state=?, duration_sec=?, size_bytes=?, updated_at=datetime('now')
          WHERE stream_uid=?
        `).bind(
          ready ? 'ready' : (payload.status && payload.status.state) || 'uploaded',
          payload.duration ? Math.round(payload.duration) : null,
          payload.size || null,
          uid
        ).run();
        if (ready && row.module_id) {
          await c.env.DB.prepare('UPDATE modules SET video_uid=?, updated_at=datetime(\'now\') WHERE id=?')
            .bind(uid, row.module_id).run();
        }
      }
    }
    return c.json({ ok: true });
  });

  /**
   * Enrollment-gated signed playback URL for a single lesson.
   *
   * Authorization order:
   *   1) educator/admin always allowed.
   *   2) on-chain CourseAccess1155.balanceOf(wallet, course.on_chain_course_id) > 0
   *   3) fallback: D1 enrollments row exists for (course_id, wallet).
   *
   * Free courses (price_usdc == 0) always pass.
   */
  app.get('/api/content/lessons/:moduleId/playback', async (c) => {
    if (!c.env.DB) return jsonError(c, 503, 'Database not configured');
    const mid = Number(c.req.param('moduleId'));
    if (!Number.isFinite(mid) || mid <= 0) return jsonError(c, 400, 'Bad module id');
    const m = await c.env.DB.prepare('SELECT * FROM modules WHERE id = ?').bind(mid).first();
    if (!m || !m.video_uid) return jsonError(c, 404, 'No video for this lesson');
    const course = await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(m.course_id).first();
    if (!course) return jsonError(c, 404, 'Course not found');

    const auth = await requireAuthLocal(c);
    let wallet = auth.error ? null : auth.wallet;
    let reason = null;
    let allowed = false;

    // Phase 6 default policy: enrollment is required for ALL courses,
    // including free ones. The legacy free-course bypass is now opt-in
    // via FREE_COURSE_PUBLIC_PLAYBACK="true" so operators who want a
    // truly anonymous "watch any free lesson" UX can re-enable it,
    // but the default matches the task's enrollment-only requirement.
    const freeBypass = String(c.env.FREE_COURSE_PUBLIC_PLAYBACK || 'false').toLowerCase() === 'true';
    if (freeBypass && Number(course.price_usdc || 0) === 0) {
      allowed = true; reason = 'free-course-public';
    } else if (wallet) {
      if (lc(course.educator_wallet) === wallet) { allowed = true; reason = 'owner'; }
      else if (await isAdmin(c.env, wallet))     { allowed = true; reason = 'admin'; }
      else {
        // Phase 6 access policy. On-chain CourseAccess1155.balanceOf is
        // the canonical source of truth. The D1 enrollments fallback is
        // gated by a feature flag because the production target is
        // strictly on-chain:
        //   ENROLLMENT_D1_FALLBACK = 'always'  → fall back when on-chain
        //                                         is false OR null
        //   ENROLLMENT_D1_FALLBACK = 'unset-only' (default) → fall back
        //                                         only when on-chain is
        //                                         null (binding missing /
        //                                         course not yet bridged).
        //                                         A definitive on-chain
        //                                         `false` denies access.
        //   ENROLLMENT_D1_FALLBACK = 'never'   → strict on-chain only.
        const policy = String(c.env.ENROLLMENT_D1_FALLBACK || 'unset-only').toLowerCase();
        const onchain = await hasOnChainAccess(c.env, wallet, course.on_chain_course_id);
        if (onchain === true) { allowed = true; reason = 'on-chain-balance'; }
        else if (policy === 'never') {
          // strict mode — deny unless on-chain says yes.
        } else {
          const shouldFallback = policy === 'always' || (policy === 'unset-only' && onchain === null);
          if (shouldFallback) {
            const enr = await c.env.DB.prepare(
              'SELECT id FROM enrollments WHERE course_id = ? AND student_wallet = ? LIMIT 1'
            ).bind(m.course_id, wallet).first();
            if (enr) { allowed = true; reason = onchain === null ? 'enrolled-d1' : 'enrolled-d1-fallback'; }
          }
        }
      }
    }
    if (!allowed) {
      return c.json({ error: 'Enrollment required', paywalled: true, course_id: m.course_id }, 403);
    }

    // Mint a Stream signed token for this UID. Phase 6: NEVER fall
    // back to an unsigned iframe URL — that would defeat the
    // enrollment-gated playback guarantee. If the Stream binding is
    // not configured we surface a 503 so the dashboard can show a
    // clean "playback unavailable" state without leaking the UID.
    // Accept either a Stream-scoped token or the combined CF_API_TOKEN
    // (callCfApi already prefers CF_API_TOKEN when both are present).
    if (!c.env.CF_ACCOUNT_ID || !(c.env.CF_STREAM_TOKEN || c.env.CF_API_TOKEN)) {
      return jsonError(c, 503, 'Cloudflare Stream not configured (CF_ACCOUNT_ID + CF_STREAM_TOKEN or CF_API_TOKEN required).');
    }
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const r = await callCfApi(c.env, `/stream/${m.video_uid}/token`, {
      method: 'POST',
      body: JSON.stringify({ exp, downloadable: false }),
    });
    if (!r.ok) return jsonError(c, r.status, r.error);
    const token = r.data.result && r.data.result.token;
    const sub = c.env.STREAM_CUSTOMER_SUBDOMAIN;
    return c.json({
      ok: true, reason, signed: true, exp, token,
      embed: sub ? `https://${sub}/${token}/iframe` : `https://iframe.cloudflarestream.com/${token}`,
      hls:   sub ? `https://${sub}/${token}/manifest/video.m3u8` : null,
    });
  });

  // ────────────── R2 generic upload + signed GET

  /**
   * Inline R2 PUT. Body: { key, contentType, base64 }. The key is
   * normalized to <kind>/<wallet>/<basename>; arbitrary client-supplied
   * paths are rejected to prevent cross-tenant overwrite.
   */
  app.post('/api/content/r2/put', async (c) => {
    const auth = await requireAuthLocal(c);
    if (auth.error) return auth.error;
    if (!r2Available(c.env)) return jsonError(c, 503, 'R2 not configured');
    let body = {}; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON'); }
    const kind = ['avatar', 'course-asset', 'misc'].includes(body.kind) ? body.kind : 'misc';
    const basename = String(body.basename || `f-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80) || 'file';
    const ct = String(body.contentType || 'application/octet-stream').slice(0, 100);
    const buf = safeB64ToBytes(body.base64);
    if (!buf) return jsonError(c, 400, 'Invalid base64 payload');
    if (buf.length > 10 * 1024 * 1024) return jsonError(c, 413, 'Max 10MB');
    // Phase 6 R2 layout: pluralized prefixes so the bucket browses cleanly
    // (avatars/, certificates/, course-assets/, misc/).
    const prefixMap = { avatar: 'avatars', certificate: 'certificates', 'course-asset': 'course-assets', misc: 'misc' };
    const prefix = prefixMap[kind] || 'misc';
    const key = `${prefix}/${auth.wallet}/${basename}`;
    await r2Put(c.env, key, buf, { contentType: ct });
    const sha = await sha256Hex(buf);
    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO r2_objects (r2_key, owner_wallet, kind, content_type, size_bytes, sha256, visibility)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(key, auth.wallet, kind, ct, buf.length, sha, kind === 'avatar' ? 'public' : 'private').run();
      } catch (_) {}
    }
    const signed = await buildSignedR2Url(c, key, 3600);
    return c.json({ ok: true, key, sha256: sha, size: buf.length, url: signed });
  });

  /**
   * Signed GET. Verifies HMAC, then streams the object out of R2. The
   * signature is bound to (key, exp) so URLs expire and cannot be
   * substituted across keys.
   */
  app.get('/api/content/r2/get', async (c) => {
    const key = c.req.query('key');
    const exp = c.req.query('exp');
    const sig = c.req.query('sig');
    if (!key || !exp || !sig) return jsonError(c, 400, 'Missing params');
    if (!/^\d+$/.test(String(exp))) return jsonError(c, 400, 'Bad exp');
    if (!r2Available(c.env)) return jsonError(c, 503, 'R2 not configured');
    const ok = await verifyR2Get(c.env, key, exp, sig);
    if (!ok) return jsonError(c, 403, 'Invalid or expired signature');
    const obj = await c.env.R2_BUCKET.get(key);
    if (!obj) return jsonError(c, 404, 'Not found');
    const headers = new Headers();
    headers.set('content-type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream');
    headers.set('cache-control', 'private, max-age=300');
    headers.set('content-length', String(obj.size));
    return new Response(obj.body, { headers });
  });

  // ────────────── Cloudflare Images

  /**
   * One-time direct creator upload URL from Cloudflare Images. The browser
   * POSTs the file directly to CF; CF returns the image_id. The client
   * then calls /persist below to record it in D1.
   */
  app.post('/api/content/images/direct-upload', async (c) => {
    const auth = await requireAuthLocal(c);
    if (auth.error) return auth.error;
    if (!c.env.CF_ACCOUNT_ID || !(c.env.CF_IMAGES_TOKEN || c.env.CF_API_TOKEN)) {
      return jsonError(c, 503, 'Cloudflare Images not configured');
    }
    let body = {}; try { body = await c.req.json(); } catch {}
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
    const fd = new FormData();
    fd.append('requireSignedURLs', 'false');
    fd.append('expiry', expires);
    fd.append('metadata', JSON.stringify({
      ownerWallet: auth.wallet,
      kind:        ['thumbnail', 'article-cover', 'avatar', 'misc'].includes(body.kind) ? body.kind : 'misc',
    }));
    const url = `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/images/v2/direct_upload`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${c.env.CF_IMAGES_TOKEN || c.env.CF_API_TOKEN}` },
      body:    fd,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) {
      const msg = (data.errors && data.errors[0] && data.errors[0].message) || `CF Images ${resp.status}`;
      return jsonError(c, resp.status, msg);
    }
    return c.json({ ok: true, id: data.result.id, uploadURL: data.result.uploadURL, expires });
  });

  /**
   * Persist a Cloudflare Images upload after the browser-side PUT
   * succeeded. The variants array is built from CF_IMAGES_DELIVERY_HASH
   * and the requested variant names ("public", "thumb", etc).
   */
  app.post('/api/content/images/persist', async (c) => {
    const auth = await requireAuthLocal(c);
    if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON'); }
    const id = String(body.id || '').slice(0, 80);
    if (!id) return jsonError(c, 400, 'id required');
    const kind = ['thumbnail', 'article-cover', 'avatar', 'misc'].includes(body.kind) ? body.kind : 'misc';
    // Phase 6: standardise on three named CF Images variants —
    //   `card`   ~ list/catalog cards (e.g. 480×270),
    //   `hero`   ~ full-width hero banners (e.g. 1600×900),
    //   `avatar` ~ square profile photos (e.g. 256×256).
    // Operators must create these three variants in the Cloudflare
    // Images dashboard. When the delivery hash is configured we
    // pre-compute all three URLs so callers (and the dashboard
    // renderer) never have to know the hash.
    const hash = c.env.CF_IMAGES_DELIVERY_HASH || '';
    const VARIANT_NAMES = ['card', 'hero', 'avatar'];
    const variantMap = {};
    if (hash) {
      for (const v of VARIANT_NAMES) {
        variantMap[v] = `https://imagedelivery.net/${hash}/${id}/${v}`;
      }
    }
    const variants = Object.values(variantMap);
    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO cf_images (cf_image_id, owner_wallet, kind, variants, meta)
          VALUES (?, ?, ?, ?, ?)
        `).bind(id, auth.wallet, kind, JSON.stringify(variantMap), JSON.stringify(body.meta || {})).run();
      } catch (_) {}
    }
    // Pick a sensible primary variant per asset kind.
    const primaryByKind = { thumbnail: 'card', 'article-cover': 'hero', avatar: 'avatar', misc: 'card' };
    const primary = variantMap[primaryByKind[kind]] || variants[0] || `https://imagedelivery.net/_/${id}/public`;
    return c.json({ ok: true, id, variants, variantMap, url: primary });
  });

  /**
   * Public avatar resolver. Looks up the most recent avatar object for
   * the wallet, mints a 5-minute signed R2 URL, and 302-redirects.
   * Storing this stable endpoint URL in `profiles.avatar_url` means
   * renderers never see an expired signature.
   */
  app.get('/api/avatars/:wallet', async (c) => {
    const wallet = lc(c.req.param('wallet') || '');
    if (!isHexAddr(wallet)) return jsonError(c, 400, 'Bad wallet');
    if (!c.env.DB) return jsonError(c, 503, 'Database not configured');
    const row = await c.env.DB.prepare(
      "SELECT r2_key FROM r2_objects WHERE owner_wallet = ? AND kind = 'avatar' ORDER BY rowid DESC LIMIT 1"
    ).bind(wallet).first();
    if (!row) return jsonError(c, 404, 'No avatar');
    if (!r2Available(c.env)) return jsonError(c, 503, 'R2 not configured');
    const signed = await buildSignedR2Url(c, row.r2_key, 5 * 60);
    if (!signed) return jsonError(c, 503, 'Signing not configured');
    // 302 so the signed URL never gets cached at the CDN level.
    return c.redirect(signed, 302);
  });

  // ────────────── Profile avatar (writer)

  app.post('/api/profile/avatar', async (c) => {
    const auth = await requireAuthLocal(c);
    if (auth.error) return auth.error;
    let body = {}; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON'); }
    const dataUrl = String(body.photo || body.dataUrl || '');
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
    if (!m) return jsonError(c, 400, 'Invalid image data url');
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const ct = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const buf = safeB64ToBytes(m[2]);
    if (!buf) return jsonError(c, 400, 'Invalid base64 image data');
    if (buf.length > 5 * 1024 * 1024) return jsonError(c, 413, 'Max 5MB');

    // Phase 6 hardening: avatars are persisted as a STABLE URL pointing
    // at the public /api/avatars/:wallet redirect endpoint below — that
    // endpoint mints a fresh short-lived signed R2 URL on every read.
    // Storing a long-lived signed URL directly in profiles.avatar_url
    // would silently break renderers when the signature expires.
    let url = null;
    let r2Key = null;
    if (r2Available(c.env)) {
      r2Key = `avatars/${auth.wallet}/profile.${ext}`;
      await r2Put(c.env, r2Key, buf, { contentType: ct });
      if (c.env.DB) {
        try {
          await c.env.DB.prepare(`
            INSERT OR REPLACE INTO r2_objects (r2_key, owner_wallet, kind, content_type, size_bytes, visibility)
            VALUES (?, ?, 'avatar', ?, ?, 'public')
          `).bind(r2Key, auth.wallet, ct, buf.length).run();
        } catch (_) {}
      }
      const origin = new URL(c.req.url).origin;
      url = `${origin}/api/avatars/${auth.wallet}`;
    }
    if (!url) return jsonError(c, 503, 'No avatar storage configured');

    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          UPDATE profiles SET avatar_url = ?, last_active_at = datetime('now')
          WHERE wallet_address = ?
        `).bind(url, auth.wallet).run();
      } catch (_) {}
    }
    return c.json({ ok: true, url, success: true });
  });

  // ────────────── Course thumbnail (CF Images)

  app.post('/api/courses/:id/thumbnail-image', async (c) => {
    const gate = await loadCourseOwned(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    let body = {}; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON'); }
    // Two acceptable inputs:
    //   1) `url` — caller already has a CF Images variant URL. We just
    //      persist it.
    //   2) `image_id` (+ optional `variant`, default 'public') — we
    //      synthesize the canonical CF Images delivery URL using the
    //      account's CF_IMAGES_DELIVERY_HASH var, so the frontend never
    //      has to know the hash.
    let url = String(body.url || '').slice(0, 500);
    const cfImageId = String(body.cf_image_id || body.image_id || '').slice(0, 80);
    const variant = String(body.variant || 'public').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'public';
    if (!url && cfImageId) {
      const hash = c.env.CF_IMAGES_DELIVERY_HASH;
      if (!hash) return jsonError(c, 503, 'CF_IMAGES_DELIVERY_HASH not configured — pass `url` instead.');
      url = `https://imagedelivery.net/${hash}/${cfImageId}/${variant}`;
    }
    if (!url) return jsonError(c, 400, 'Provide either `url` or `image_id`');
    await c.env.DB.prepare('UPDATE courses SET thumbnail_url = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(url, gate.course.id).run();
    if (cfImageId && c.env.DB) {
      try {
        await c.env.DB.prepare(`UPDATE cf_images SET kind='thumbnail' WHERE cf_image_id = ?`).bind(cfImageId).run();
      } catch (_) {}
    }
    return c.json({ ok: true, url });
  });

  /**
   * Mint a fresh signed GET URL for an R2 object the caller already
   * owns. Used by the dashboard / email links to refresh the 5-minute
   * certificate URL without re-issuing the certificate. Authorization
   * checks the r2_objects.owner_wallet column so a learner can only
   * refresh URLs for their own assets.
   */
  app.get('/api/content/r2/refresh-url', async (c) => {
    const auth = await requireAuthLocal(c);
    if (auth.error) return auth.error;
    const key = c.req.query('key');
    if (!key) return jsonError(c, 400, 'key required');
    if (!c.env.DB) return jsonError(c, 503, 'Database not configured');
    const row = await c.env.DB.prepare(
      'SELECT owner_wallet, kind FROM r2_objects WHERE r2_key = ?'
    ).bind(key).first();
    if (!row) return jsonError(c, 404, 'Object not found');
    const isOwner = lc(row.owner_wallet) === auth.wallet;
    if (!isOwner && !(await isAdmin(c.env, auth.wallet))) return jsonError(c, 403, 'Not your object');
    const url = await buildSignedR2Url(c, key, 5 * 60);
    if (!url) return jsonError(c, 503, 'Signing key not configured');
    return c.json({ ok: true, url, exp_sec: 300 });
  });

  // ────────────── Article cover image

  app.post('/api/articles/:id/cover', async (c) => {
    const auth = await requireAuthLocal(c);
    if (auth.error) return auth.error;
    if (!c.env.DB) return jsonError(c, 503, 'Database not configured');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return jsonError(c, 400, 'Bad article id');
    const article = await c.env.DB.prepare('SELECT id, author_wallet FROM articles WHERE id = ?').bind(id).first();
    if (!article) return jsonError(c, 404, 'Article not found');
    if (lc(article.author_wallet) !== auth.wallet && !(await isAdmin(c.env, auth.wallet))) {
      return jsonError(c, 403, 'Not your article');
    }
    let body = {}; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON'); }
    const url = String(body.url || '').slice(0, 500);
    if (!url) return jsonError(c, 400, 'url required');
    await c.env.DB.prepare('UPDATE articles SET image_url = ? WHERE id = ?').bind(url, id).run();
    return c.json({ ok: true, url });
  });

  // ────────────── Issue certificate (PDF + email + log)

  app.post('/api/courses/:id/issue-certificate', async (c) => {
    const gate = await loadCourseOwned(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    let body = {}; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON'); }
    const studentWallet = isHexAddr(body.student_wallet) ? lc(body.student_wallet) : null;
    if (!studentWallet) return jsonError(c, 400, 'student_wallet required');

    // Confirm enrollment exists.
    const enr = await c.env.DB.prepare(
      'SELECT id, progress FROM enrollments WHERE course_id = ? AND student_wallet = ? LIMIT 1'
    ).bind(gate.course.id, studentWallet).first();
    if (!enr) return jsonError(c, 404, 'Student not enrolled in this course');

    // Fetch student profile (display name + email).
    const studentProfile = await c.env.DB.prepare(
      'SELECT display_name, email FROM profiles WHERE wallet_address = ?'
    ).bind(studentWallet).first();
    const eduProfile = await c.env.DB.prepare(
      'SELECT display_name FROM profiles WHERE wallet_address = ?'
    ).bind(lc(gate.course.educator_wallet)).first();

    // Build PDF.
    const pdf = buildCertificatePdf({
      learnerName:  (studentProfile && studentProfile.display_name) || studentWallet,
      courseTitle:  gate.course.title,
      educatorName: (eduProfile && eduProfile.display_name) || gate.course.educator_wallet,
      dateStr:      new Date().toISOString().slice(0, 10),
      txHash:       body.tx_hash || null,
    });
    const sha = await sha256Hex(pdf);

    // Persist to R2 (or skip with 503 if not configured).
    let pdfUrl = null;
    let r2Key = null;
    if (r2Available(c.env)) {
      r2Key = `certificates/${studentWallet}/${gate.course.id}-${sha.slice(0,12)}.pdf`;
      await r2Put(c.env, r2Key, pdf, { contentType: 'application/pdf' });
      if (c.env.DB) {
        try {
          await c.env.DB.prepare(`
            INSERT OR REPLACE INTO r2_objects (r2_key, owner_wallet, kind, content_type, size_bytes, sha256, visibility)
            VALUES (?, ?, 'certificate', 'application/pdf', ?, ?, 'private')
          `).bind(r2Key, studentWallet, pdf.length, sha).run();
        } catch (_) {}
      }
      // Phase 6: protected assets (certificate PDFs) get a SHORT 5-minute
      // signed GET URL. The dashboard / email link should call
      // /api/content/r2/refresh-url to mint a fresh URL on demand instead
      // of caching a long-lived link in the recipient's mailbox.
      pdfUrl = await buildSignedR2Url(c, r2Key, 5 * 60);
    }

    // Send email if we have a recipient + mail configured.
    let emailStatus = 'skipped';
    const recipient = (studentProfile && studentProfile.email) || body.email || null;
    if (recipient && pdfUrl) {
      const tpl = tplCertificateIssued({
        courseTitle:  gate.course.title,
        learnerName:  (studentProfile && studentProfile.display_name) || null,
        pdfUrl,
        txHash:       body.tx_hash || null,
      });
      const send = await sendEmail(c.env, {
        to:      { email: recipient, name: (studentProfile && studentProfile.display_name) || undefined },
        subject: tpl.subject, html: tpl.html, text: tpl.text,
      });
      emailStatus = send.ok ? 'sent' : 'failed';
      await logEmail(c.env, {
        recipient, template: 'certificate-issued', subject: tpl.subject,
        status: emailStatus, error: send.error || null, message_id: send.message_id || null,
        meta: { course_id: gate.course.id },
      });
    }

    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO certificates_issued
            (course_id, student_wallet, educator_wallet, enrollment_id, pdf_r2_key, pdf_sha256, on_chain_tx, email, email_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          gate.course.id, studentWallet, lc(gate.course.educator_wallet),
          enr.id, r2Key, sha, body.tx_hash || null, recipient || null, emailStatus
        ).run();
      } catch (_) {}
    }
    // Response contract: expose both naming conventions so existing
    // dashboard callers (`url`, `email`) and any future scripts using the
    // documented worker fields (`pdf_url`, `email_status`) both work.
    return c.json({
      ok: true,
      url: pdfUrl, pdf_url: pdfUrl,
      r2_key: r2Key,
      sha256: sha,
      email: emailStatus, email_status: emailStatus,
    });
  });

  // ────────────── Send "course published" notification (admin/educator)

  app.post('/api/courses/:id/notify-published', async (c) => {
    const gate = await loadCourseOwned(c, c.req.param('id'));
    if (gate.fail) return gate.fail;
    const eduProfile = await c.env.DB.prepare(
      'SELECT display_name, email FROM profiles WHERE wallet_address = ?'
    ).bind(lc(gate.course.educator_wallet)).first();
    if (!eduProfile || !eduProfile.email) return jsonError(c, 400, 'Educator has no email on file');
    const tpl = tplCoursePublished({
      courseTitle:  gate.course.title,
      courseSlug:   gate.course.slug,
      educatorName: eduProfile.display_name,
    });
    const send = await sendEmail(c.env, {
      to: { email: eduProfile.email, name: eduProfile.display_name || undefined },
      subject: tpl.subject, html: tpl.html, text: tpl.text,
    });
    await logEmail(c.env, {
      recipient: eduProfile.email, template: 'course-published', subject: tpl.subject,
      status: send.ok ? 'sent' : 'failed', error: send.error || null, message_id: send.message_id || null,
      meta: { course_id: gate.course.id },
    });
    return c.json({ ok: send.ok, error: send.error || null });
  });
}
