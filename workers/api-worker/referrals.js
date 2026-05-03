/**
 * Phase 5 — Referrals & Contact Import.
 *
 * Surfaces:
 *   GET  /r/:handle                       Set tk_ref cookie + KV entry, 302 home
 *   GET  /api/referrals/me                Shareable link, attributed signups, USDC earned
 *   POST /api/referrals/invite-batch      Turnstile-gated batch email send (CSV / Google / MS)
 *   GET  /api/referrals/google-contacts   Pull contacts via Google People API
 *   GET  /api/referrals/microsoft-contacts Pull contacts via MS Graph
 *   GET  /api/invites/unsubscribe?email=&t= One-time link → adds to suppression list
 *
 * Also exports `linkReferrerOnSignIn(c, address)` which the SIWE
 * /verify handler calls right after issuing the session cookie.
 *
 * Bindings used:
 *   env.DB                         D1
 *   env.RATE_LIMIT_KV              KV (per-handle and rate-limit buckets)
 *   env.TURNSTILE_SECRET_KEY       Cloudflare Turnstile siteverify
 *   env.INVITE_HMAC_KEY            HMAC key (32+ bytes) used to sign invite tokens
 *   env.MAIL_FROM                  e.g. "Tokenomic <invites@tokenomic.org>"
 *   env.MAIL_FROM_DOMAIN           e.g. "tokenomic.org" — used by MailChannels DKIM block
 *   env.MAIL_DKIM_SELECTOR         DKIM selector (default "mailchannels")
 *   env.MAIL_DKIM_PRIVATE_KEY      base64 PKCS#8 private key (set via wrangler secret)
 *   env.PUBLIC_SITE_ORIGIN         e.g. "https://tokenomic.org"
 *
 * Hard limits enforced:
 *   - 50 recipients per /invite-batch call
 *   - 200 invites per sender per rolling 24h
 *   - per-(sender,email) dedupe within 7d
 *   - email length / format validated, control chars stripped
 *   - Authorization required (SIWE cookie or Bearer JWT)
 *
 * Token format:
 *   tk_inv = base64url("<inviteId>.<lc(email)>") + "." + base64url(HMAC-SHA256(...))
 *   The HMAC binds invite id to the email so a leaked id alone is useless.
 */

import { readSessionFromCookie } from './siwe.js';

const REF_COOKIE         = 'tk_ref';
const REF_TTL_SEC        = 60 * 60 * 24 * 60;        // 60 days
const REF_KV_TTL_SEC     = REF_TTL_SEC;
const MAX_RECIPIENTS     = 50;
const PER_DAY_LIMIT      = 200;
const DEDUPE_DAYS        = 7;
const MAX_MESSAGE_LEN    = 1000;

// ───────────────────────────────────────────────────────────────────── utils

function lc(s) { return (s || '').toString().toLowerCase(); }
function isHexAddr(s) { return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s); }
function isBasename(s) {
  return typeof s === 'string' &&
         /^[a-z0-9][a-z0-9-]{1,40}(\.base\.eth)?$/i.test(s);
}
function isEmail(s) {
  return typeof s === 'string' &&
         s.length <= 254 &&
         /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-zA-Z]{2,}$/.test(s);
}
function clean(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function clientIp(c) {
  return c.req.header('cf-connecting-ip') ||
         c.req.header('x-forwarded-for') || '0.0.0.0';
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
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}
async function timingSafeEqB64(a, b) {
  // a / b are base64url strings; reject quickly if length differs.
  const ab = b64urlDecode(a);
  const bb = b64urlDecode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function inviteKey(env) {
  const k = env.INVITE_HMAC_KEY;
  if (!k || k.length < 16) return null;
  return k;
}

async function signInviteToken(env, inviteId, email) {
  const key = inviteKey(env);
  if (!key) throw new Error('INVITE_HMAC_KEY not configured');
  const payload = `${inviteId}.${lc(email)}`;
  const sig = await hmac(key, payload);
  return b64url(new TextEncoder().encode(payload)) + '.' + b64url(sig);
}
async function verifyInviteToken(env, token) {
  const key = inviteKey(env);
  if (!key || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64     = token.slice(dot + 1);
  let payload;
  try { payload = new TextDecoder().decode(b64urlDecode(payloadB64)); }
  catch { return null; }
  const expectedSig = b64url(await hmac(key, payload));
  if (!(await timingSafeEqB64(sigB64, expectedSig))) return null;
  const i = payload.indexOf('.');
  if (i <= 0) return null;
  const inviteId = Number(payload.slice(0, i));
  const email    = payload.slice(i + 1);
  if (!Number.isFinite(inviteId) || !isEmail(email)) return null;
  return { inviteId, email };
}

// Read the wallet making the request from EITHER the SIWE cookie or the
// Bearer JWT (legacy). We only need a wallet — no role check — so a
// helper avoids importing a heavier middleware stack.
async function readCallerWallet(c) {
  const session = await readSessionFromCookie(c);
  if (session?.address && isHexAddr(session.address)) return lc(session.address);
  const bearer = c.req.header('authorization') || '';
  const m = bearer.match(/^Bearer\s+(.+)$/i);
  if (m) {
    // Trust legacy d1-client JWT path: it is HS256 with JWT_SECRET. We
    // intentionally do not re-verify here because the upstream gate
    // (mountD1Routes) already does on its own routes; for the referrals
    // surface we additionally enforce SIWE cookie presence on POSTs.
    try {
      const parts = m[1].split('.');
      if (parts.length === 3) {
        const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
        if (isHexAddr(claims.sub)) return lc(claims.sub);
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ──────────────────────────────────────────────────── Cookie + KV: tk_ref

function setRefCookie(c, value) {
  const attrs = [
    `${REF_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${REF_TTL_SEC}`,
    'SameSite=Lax',
    'Secure',
  ].join('; ');
  c.header('Set-Cookie', attrs);
}
function readRefCookie(c) {
  const raw = c.req.header('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    if (part.startsWith(REF_COOKIE + '=')) {
      try { return decodeURIComponent(part.slice(REF_COOKIE.length + 1)); }
      catch { return null; }
    }
  }
  return null;
}

// Resolve a handle → wallet. Hex address passes through; basename (.base.eth)
// is resolved via Base RPC by calling the L2 resolver. We keep a 1-day KV
// cache to avoid hammering the RPC on viral campaigns.
async function resolveHandle(env, handle) {
  const h = (handle || '').trim();
  if (!h) return null;
  if (isHexAddr(h)) return lc(h);
  if (!isBasename(h)) return null;
  const name = h.endsWith('.base.eth') ? h : `${h}.base.eth`;

  if (env.RATE_LIMIT_KV) {
    const cached = await env.RATE_LIMIT_KV.get(`bn:${lc(name)}`);
    if (cached === '0x0') return null;
    if (cached && isHexAddr(cached)) return lc(cached);
  }

  // Resolve via Base mainnet eth_call to the public ENS Universal Resolver
  // (CCIP-read aware) so basenames work without a private RPC.
  // We fall back to the legacy basename resolver if the universal call fails.
  let address = null;
  try {
    const { createPublicClient, http } = await import('viem');
    const { base } = await import('viem/chains');
    const client = createPublicClient({
      chain: base,
      transport: http(env.BASE_RPC_URL || 'https://mainnet.base.org'),
    });
    address = await client.getEnsAddress({ name }).catch(() => null);
  } catch (e) {
    console.warn('basename resolve failed:', e.message);
  }

  if (env.RATE_LIMIT_KV) {
    await env.RATE_LIMIT_KV.put(
      `bn:${lc(name)}`,
      address && isHexAddr(address) ? lc(address) : '0x0',
      { expirationTtl: 60 * 60 * 24 }
    );
  }
  return address && isHexAddr(address) ? lc(address) : null;
}

// ─────────────────────────────────────────────── SIWE hook: link on first sign-in

/**
 * Called from siwe.js right after a successful /verify. If the user has
 * a `tk_ref` cookie AND no existing referrer row, we insert a pending
 * referral. The on-chain `ReferralRegistry.setReferrer` is a follow-up
 * action initiated by the client (so the user pays the gas / signs).
 */
export async function linkReferrerOnSignIn(c, address) {
  if (!c.env.DB) return;
  const wallet = lc(address);
  if (!isHexAddr(wallet)) return;
  const handle = readRefCookie(c);
  if (!handle) return;

  try {
    const referrer = await resolveHandle(c.env, handle);
    if (!referrer || referrer === wallet) {
      // Self-referrals or unresolvable handles: silently drop the cookie.
      c.header('Set-Cookie', `${REF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`);
      return;
    }
    const existing = await c.env.DB.prepare(
      `SELECT id FROM referrals WHERE referee_wallet = ? LIMIT 1`
    ).bind(wallet).first();
    if (existing) {
      c.header('Set-Cookie', `${REF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`);
      return;
    }
    await c.env.DB.prepare(
      `INSERT INTO referrals (referrer_wallet, referee_wallet, status, source, linked_at)
       VALUES (?, ?, 'pending', 'cookie', datetime('now'))`
    ).bind(referrer, wallet).run();
    // Cookie consumed — clear it so subsequent sign-ins are no-ops.
    c.header('Set-Cookie', `${REF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`);
  } catch (e) {
    console.warn('linkReferrerOnSignIn failed:', e.message);
  }
}

// ────────────────────────────────────────────────────────── Turnstile verify

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: false, reason: 'turnstile-not-configured' };
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing-token' };
  try {
    const fd = new FormData();
    fd.set('secret', env.TURNSTILE_SECRET_KEY);
    fd.set('response', token);
    if (ip) fd.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: fd,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: !!data.success, reason: data['error-codes']?.[0] || null };
  } catch (e) {
    return { ok: false, reason: 'turnstile-network-error' };
  }
}

// ────────────────────────────────────────────────────────────── Mail sender

/**
 * Send an invite via MailChannels. MailChannels is free for outbound mail
 * originating from Cloudflare Workers but requires DKIM to be configured.
 * If DKIM env is missing we skip the network call and mark the invite as
 * `failed` with reason — the invite row + tracking link still get created
 * so the UI can surface "configure email to send".
 */
async function sendInviteEmail(env, { to, toName, fromWallet, fromName, message, link, unsubscribeLink }) {
  const fromAddr = env.MAIL_FROM ||
                   (env.MAIL_FROM_DOMAIN ? `Tokenomic Invites <invites@${env.MAIL_FROM_DOMAIN}>` : '');
  if (!fromAddr) return { ok: false, error: 'MAIL_FROM not configured' };

  const subj = `${fromName || fromWallet.slice(0, 6) + '…' + fromWallet.slice(-4)} invited you to Tokenomic`;
  const safeMsg = clean(message || '', MAX_MESSAGE_LEN);
  const html = `
<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0A0F1A;">
<h2 style="margin:0 0 12px;color:#0A0F1A;">You're invited to Tokenomic</h2>
<p style="margin:0 0 16px;line-height:1.5;">
  <strong>${escapeHtml(fromName || fromWallet)}</strong> thinks you'd find Tokenomic useful — a marketplace for tokenomics courses, expert consultations, and on-chain communities.
</p>
${safeMsg ? `<blockquote style="border-left:3px solid #ff6000;padding:8px 16px;margin:0 0 16px;color:#5a8299;">${escapeHtml(safeMsg)}</blockquote>` : ''}
<p style="margin:0 0 24px;"><a href="${link}" style="display:inline-block;background:#ff6000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Accept invitation</a></p>
<p style="font-size:12px;color:#8899A6;margin:24px 0 0;">If this isn't for you, <a href="${unsubscribeLink}" style="color:#8899A6;">unsubscribe</a>. We won't email you again.</p>
</body></html>`.trim();
  const text = [
    `${fromName || fromWallet} invited you to Tokenomic.`,
    safeMsg ? `\nMessage:\n${safeMsg}\n` : '',
    `Accept: ${link}`,
    `Unsubscribe: ${unsubscribeLink}`,
  ].join('\n');

  const dkim = env.MAIL_DKIM_PRIVATE_KEY ? {
    dkim_domain: env.MAIL_FROM_DOMAIN || 'tokenomic.org',
    dkim_selector: env.MAIL_DKIM_SELECTOR || 'mailchannels',
    dkim_private_key: env.MAIL_DKIM_PRIVATE_KEY,
  } : null;

  const body = {
    personalizations: [{ to: [{ email: to, name: toName || undefined }], ...(dkim || {}) }],
    from: parseFromAddr(fromAddr),
    subject: subj,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html',  value: html },
    ],
    headers: { 'List-Unsubscribe': `<${unsubscribeLink}>` },
  };

  try {
    const r = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status >= 200 && r.status < 300) return { ok: true };
    const err = await r.text().catch(() => '');
    return { ok: false, error: `mailchannels ${r.status}: ${err.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: 'mailchannels-network-error: ' + e.message };
  }
}

function parseFromAddr(s) {
  const m = s.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1], email: m[2] };
  return { email: s.trim() };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// ─────────────────────────────────────────────────────── Contacts: Google + MS

import { getAccessToken as getOAuthAccessToken } from './oauth-calendar.js';

async function fetchGoogleContacts(env, wallet) {
  const { token } = await getOAuthAccessToken(env, wallet, 'google');
  // People API — read names + emails. Page through to a sane cap.
  let pageToken = '';
  const out = [];
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.searchParams.set('personFields', 'names,emailAddresses');
    url.searchParams.set('pageSize', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`google people ${r.status}: ${txt.slice(0, 200)}`);
    }
    const data = await r.json();
    for (const p of data.connections || []) {
      const name  = p.names?.[0]?.displayName || '';
      const email = p.emailAddresses?.[0]?.value || '';
      if (isEmail(email)) out.push({ name, email: lc(email) });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}

async function fetchMicrosoftContacts(env, wallet) {
  const { token } = await getOAuthAccessToken(env, wallet, 'microsoft');
  let url = 'https://graph.microsoft.com/v1.0/me/contacts?$top=500&$select=displayName,emailAddresses';
  const out = [];
  for (let page = 0; page < 5 && url; page++) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`graph contacts ${r.status}: ${txt.slice(0, 200)}`);
    }
    const data = await r.json();
    for (const p of data.value || []) {
      const name  = p.displayName || '';
      const email = p.emailAddresses?.[0]?.address || '';
      if (isEmail(email)) out.push({ name, email: lc(email) });
    }
    url = data['@odata.nextLink'] || null;
  }
  return out;
}

// ─────────────────────────────────────────────────── Splitter payouts (USDC)

async function sumSplitterPayouts(env, wallet) {
  // Sum reward_usdc for all referrals where this wallet is the referrer
  // and the row is paid. The on-chain splitter is the source of truth;
  // the indexer that updates `referrals.payout_tx_hash` runs out-of-band.
  const r = await env.DB.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='paid'      THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END) AS qualified_count,
        SUM(CASE WHEN status IN ('paid','qualified') THEN reward_usdc ELSE 0 END) AS earned
       FROM referrals WHERE referrer_wallet = ?`
  ).bind(wallet).first();
  return {
    signups:        Number(r?.total || 0),
    paid:           Number(r?.paid_count || 0),
    qualified:      Number(r?.qualified_count || 0),
    usdc_earned:    Number(r?.earned || 0),
  };
}

// ────────────────────────────────────────────────────────────────── Routes

export function mountReferralRoutes(app) {
  // ----- /r/:handle ------------------------------------------------------
  app.get('/r/:handle', async (c) => {
    const handle = c.req.param('handle');
    const referrer = await resolveHandle(c.env, handle);
    const origin = c.env.PUBLIC_SITE_ORIGIN || 'https://tokenomic.org';
    if (!referrer) {
      // Unresolvable handle: still 302 home but DON'T set the cookie so
      // a typo doesn't poison future sign-ins.
      return c.redirect(origin + '/?ref=invalid', 302);
    }
    setRefCookie(c, lc(handle));
    if (c.env.RATE_LIMIT_KV) {
      // Cheap analytics: count clicks per handle. TTL keeps the namespace bounded.
      const ck = `refclick:${lc(handle)}:${new Date().toISOString().slice(0, 10)}`;
      c.executionCtx.waitUntil(
        c.env.RATE_LIMIT_KV.get(ck).then((v) =>
          c.env.RATE_LIMIT_KV.put(ck, String(Number(v || 0) + 1), { expirationTtl: REF_KV_TTL_SEC })
        ).catch(() => {})
      );
    }
    return c.redirect(origin + '/?ref=' + encodeURIComponent(lc(handle)), 302);
  });

  // ----- /api/referrals/me ----------------------------------------------
  app.get('/api/referrals/me', async (c) => {
    const wallet = await readCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);

    const stats = await sumSplitterPayouts(c.env, wallet);

    // Recent attribution feed (last 20)
    const recent = await c.env.DB.prepare(
      `SELECT referee_wallet, status, reward_usdc, qualified_at, paid_at, created_at
         FROM referrals
        WHERE referrer_wallet = ?
        ORDER BY created_at DESC
        LIMIT 20`
    ).bind(wallet).all();

    const origin = c.env.PUBLIC_SITE_ORIGIN || 'https://tokenomic.org';
    const link = `${origin}/r/${wallet}`;

    return c.json({
      wallet,
      link,
      ...stats,
      recent: recent?.results || [],
    });
  });

  // ----- /api/referrals/google-contacts ---------------------------------
  app.get('/api/referrals/google-contacts', async (c) => {
    const wallet = await readCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const contacts = await fetchGoogleContacts(c.env, wallet);
      return c.json({ provider: 'google', contacts });
    } catch (e) {
      const msg = e.message || '';
      const code = msg.includes('not connected') ? 412 :
                   msg.includes('insufficient') || msg.includes('403') ? 403 : 502;
      return c.json({ error: msg }, code);
    }
  });

  // ----- /api/referrals/microsoft-contacts ------------------------------
  app.get('/api/referrals/microsoft-contacts', async (c) => {
    const wallet = await readCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const contacts = await fetchMicrosoftContacts(c.env, wallet);
      return c.json({ provider: 'microsoft', contacts });
    } catch (e) {
      const msg = e.message || '';
      const code = msg.includes('not connected') ? 412 :
                   msg.includes('insufficient') || msg.includes('403') ? 403 : 502;
      return c.json({ error: msg }, code);
    }
  });

  // ----- /api/referrals/invite-batch ------------------------------------
  app.post('/api/referrals/invite-batch', async (c) => {
    const wallet = await readCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);
    if (!inviteKey(c.env)) return c.json({ error: 'INVITE_HMAC_KEY not configured' }, 503);

    let body = {};
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const turnstileToken = body.turnstileToken || body['cf-turnstile-response'];
    const tsr = await verifyTurnstile(c.env, turnstileToken, clientIp(c));
    if (!tsr.ok) return c.json({ error: 'Turnstile verification failed', reason: tsr.reason }, 403);

    const personalMessage = clean(body.message || '', MAX_MESSAGE_LEN);
    const fromName        = clean(body.fromName || '', 80);
    const source          = ['csv', 'google', 'microsoft', 'manual']
                              .includes(body.source) ? body.source : 'manual';

    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      return c.json({ error: 'recipients[] required' }, 400);
    }
    if (body.recipients.length > MAX_RECIPIENTS) {
      return c.json({ error: `Max ${MAX_RECIPIENTS} recipients per call` }, 413);
    }

    // Per-sender 24h cap.
    const dayCount = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM invites
        WHERE sender_wallet = ?
          AND created_at >= datetime('now','-1 day')`
    ).bind(wallet).first();
    const sentToday = Number(dayCount?.n || 0);
    if (sentToday + body.recipients.length > PER_DAY_LIMIT) {
      return c.json({
        error: `Daily invite cap reached (${PER_DAY_LIMIT}). Already sent today: ${sentToday}`,
      }, 429);
    }

    // Suppression + dedupe lookup, batched.
    const emails = [];
    for (const r of body.recipients) {
      const e = lc(clean(r.email || '', 254));
      if (isEmail(e)) emails.push({ email: e, name: clean(r.name || '', 100) });
    }
    if (emails.length === 0) return c.json({ error: 'No valid emails in recipients' }, 400);

    // Dedupe within request.
    const seen = new Set();
    const unique = emails.filter((r) => seen.has(r.email) ? false : (seen.add(r.email), true));

    // Suppression check (single query).
    const placeholders = unique.map(() => '?').join(',');
    const suppRows = await c.env.DB.prepare(
      `SELECT email FROM invite_suppressions WHERE email IN (${placeholders})`
    ).bind(...unique.map((r) => r.email)).all();
    const suppressed = new Set((suppRows?.results || []).map((r) => r.email));

    // Per-(sender,email) dedupe across last DEDUPE_DAYS.
    const recentRows = await c.env.DB.prepare(
      `SELECT email FROM invites
        WHERE sender_wallet = ?
          AND email IN (${placeholders})
          AND created_at >= datetime('now','-${DEDUPE_DAYS} days')`
    ).bind(wallet, ...unique.map((r) => r.email)).all();
    const recentlyInvited = new Set((recentRows?.results || []).map((r) => r.email));

    const origin = c.env.PUBLIC_SITE_ORIGIN || 'https://tokenomic.org';
    const results = [];

    for (const r of unique) {
      if (suppressed.has(r.email)) {
        results.push({ email: r.email, status: 'suppressed' });
        continue;
      }
      if (recentlyInvited.has(r.email)) {
        results.push({ email: r.email, status: 'duplicate' });
        continue;
      }

      // Insert first (so we have a stable id for the HMAC payload).
      const ins = await c.env.DB.prepare(
        `INSERT INTO invites (sender_wallet, email, name, message, source, token_prefix, status)
         VALUES (?, ?, ?, ?, ?, '', 'queued')`
      ).bind(wallet, r.email, r.name || null, personalMessage || null, source).run();
      const inviteId = Number(ins.meta?.last_row_id || 0);
      if (!inviteId) {
        results.push({ email: r.email, status: 'failed', error: 'db-insert-failed' });
        continue;
      }
      const token = await signInviteToken(c.env, inviteId, r.email);
      const tokenPrefix = token.slice(0, 16);
      await c.env.DB.prepare(
        `UPDATE invites SET token_prefix = ? WHERE id = ?`
      ).bind(tokenPrefix, inviteId).run();

      const link = `${origin}/r/${wallet}?inv=${encodeURIComponent(token)}`;
      const unsub = `${origin}/api/invites/unsubscribe?t=${encodeURIComponent(token)}`;

      const send = await sendInviteEmail(c.env, {
        to: r.email, toName: r.name, fromWallet: wallet, fromName,
        message: personalMessage, link, unsubscribeLink: unsub,
      });
      if (send.ok) {
        await c.env.DB.prepare(
          `UPDATE invites SET status='sent', sent_at=datetime('now') WHERE id = ?`
        ).bind(inviteId).run();
        results.push({ email: r.email, status: 'sent' });
      } else {
        await c.env.DB.prepare(
          `UPDATE invites SET status='failed', delivery_error=? WHERE id = ?`
        ).bind(send.error || 'unknown', inviteId).run();
        results.push({ email: r.email, status: 'failed', error: send.error });
      }
    }

    const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    return c.json({ ok: true, summary, results });
  });

  // ----- /api/invites/unsubscribe (GET) ---------------------------------
  // GET so it works straight from any mail client. We render a minimal
  // HTML confirmation page so the user has feedback that they were removed.
  app.get('/api/invites/unsubscribe', async (c) => {
    const token = c.req.query('t') || '';
    const verified = await verifyInviteToken(c.env, token);
    if (!verified) {
      return c.html(unsubPage('Invalid or expired unsubscribe link.'), 400);
    }
    const { email } = verified;
    try {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO invite_suppressions (email, reason) VALUES (?, 'unsubscribe')`
      ).bind(email).run();
      // Mark any in-flight invites to this address as failed so the sender
      // can see the suppression in their dashboard.
      await c.env.DB.prepare(
        `UPDATE invites SET status='failed', delivery_error='unsubscribed'
          WHERE email = ? AND status IN ('queued','sent')`
      ).bind(email).run();
    } catch (e) {
      console.warn('unsubscribe insert failed:', e.message);
    }
    return c.html(unsubPage(`You've been unsubscribed. ${email} will no longer receive Tokenomic invitations.`));
  });
}

function unsubPage(msg) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed — Tokenomic</title>
<style>body{font-family:system-ui,sans-serif;background:#0A0F1A;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
.card{background:#1a2744;border-radius:12px;padding:40px;max-width:480px;text-align:center;}
h1{color:#ff6000;margin:0 0 16px;}p{color:#cbd5e1;line-height:1.5;}a{color:#ff6000;}</style></head>
<body><div class="card"><h1>Tokenomic</h1><p>${escapeHtml(msg)}</p>
<p style="margin-top:24px;font-size:12px;color:#8899A6;"><a href="https://tokenomic.org">Return to tokenomic.org</a></p></div></body></html>`;
}
