/**
 * Phase 5 — Referrals & Contact Import.
 *
 * Surfaces:
 *   GET  /r/:handle                        Set tk_ref cookie + KV entry, 302 home
 *   GET  /api/referrals/me                 Shareable link, attributed signups,
 *                                          USDC earned, optional pending_link
 *                                          asking the dashboard to sign one
 *                                          ReferralRegistry.setReferrer tx
 *   POST /api/referrals/confirm-link       Verify a tx hash that the referee
 *                                          submitted via their wallet, then
 *                                          flip the D1 row to status='linked'
 *   POST /api/referrals/invite-batch       Turnstile-gated; enqueues each
 *                                          recipient onto the INVITE_QUEUE
 *   GET  /api/referrals/google-contacts    Pull contacts via Google People API
 *   GET  /api/referrals/microsoft-contacts Pull contacts via MS Graph
 *   GET  /api/invites/unsubscribe?t=…      One-time link → suppression list
 *
 * Also exports:
 *   linkReferrerOnSignIn(c, address)       Called from siwe.js /verify
 *   handleInviteQueueBatch(batch, env)     Consumer for the INVITE_QUEUE
 *
 * AUTH (FIXED):
 *   ALL referral endpoints resolve the caller via resolveSession() from
 *   ./auth.js, which validates the SIWE cookie HMAC + expiry. No raw JWT
 *   parsing. Anonymous callers get 401.
 *
 * ON-CHAIN ATTRIBUTION (FIXED):
 *   ReferralRegistry.setReferrer(referrer) requires msg.sender == referee,
 *   so the worker physically cannot sign for the user. The flow is:
 *     1. linkReferrerOnSignIn() inserts a D1 row status='pending' on first
 *        sign-in (consumes the tk_ref cookie).
 *     2. /api/referrals/me returns a `pending_link` block when the referee
 *        has a pending row AND ReferralRegistry.referrerOf(referee) is
 *        still address(0). The dashboard surfaces the prompt and uses the
 *        already-connected wallet to send setReferrer in one tx.
 *     3. /api/referrals/confirm-link verifies the tx receipt against the
 *        on-chain contract and flips the row to 'linked' (or 'failed').
 *
 * INVITE PIPELINE (FIXED):
 *   POST /invite-batch is a queue producer. It validates input, runs
 *   Turnstile + rate-limit + suppression + dedupe, inserts D1 invite rows
 *   in status='queued', then sends each recipient onto INVITE_QUEUE.
 *   The queue consumer (handleInviteQueueBatch) pulls each message and
 *   does the MailChannels send, updating status to 'sent' / 'failed'.
 *   Cloudflare Queues retries failed messages with backoff.
 *
 * Bindings used:
 *   env.DB                         D1
 *   env.RATE_LIMIT_KV              KV (per-handle and rate-limit buckets)
 *   env.INVITE_QUEUE               Cloudflare Queue (producer binding)
 *   env.TURNSTILE_SECRET_KEY       Cloudflare Turnstile siteverify
 *   env.INVITE_HMAC_KEY            HMAC key (≥32 bytes) signing invite tokens
 *   env.MAIL_FROM                  e.g. "Tokenomic <invites@tokenomic.org>"
 *   env.MAIL_FROM_DOMAIN           e.g. "tokenomic.org" — MailChannels DKIM
 *   env.MAIL_DKIM_SELECTOR         DKIM selector (default "mailchannels")
 *   env.MAIL_DKIM_PRIVATE_KEY      base64 PKCS#8 private key (wrangler secret)
 *   env.PUBLIC_SITE_ORIGIN         e.g. "https://tokenomic.org"
 *   env.REFERRAL_REGISTRY          deployed contract address on Base
 *   env.REFERRAL_REGISTRY_CHAIN_ID 8453 (mainnet) / 84532 (sepolia)
 *
 * Hard limits enforced:
 *   - 50 recipients per /invite-batch call
 *   - 200 invites per sender per rolling 24h
 *   - per-(sender,email) dedupe within 7d
 *   - email length / format validated, control chars stripped
 */

import { resolveSession } from './auth.js';

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
function isTxHash(s) { return typeof s === 'string' && /^0x[0-9a-fA-F]{64}$/.test(s); }
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

/**
 * Token payload format: `<inviteId>.<lc(email)>.<lc(senderWallet)>`
 *
 * The sender is bound into the signed payload so an attacker who learns a
 * valid token cannot present it on /r/<otherHandle>?inv=<token> and steal
 * the referrer credit. /r/:handle enforces senderWallet == resolveHandle(:handle).
 */
async function signInviteToken(env, inviteId, email, sender) {
  const key = inviteKey(env);
  if (!key) throw new Error('INVITE_HMAC_KEY not configured');
  if (!isHexAddr(sender)) throw new Error('signInviteToken: invalid sender');
  const payload = `${inviteId}.${lc(email)}.${lc(sender)}`;
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
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  const inviteId = Number(parts[0]);
  const email    = parts[1];
  const sender   = parts[2];
  if (!Number.isFinite(inviteId) || !isEmail(email) || !isHexAddr(sender)) return null;
  return { inviteId, email, sender: lc(sender) };
}

// ─────────────────────────────────────────────────────────── AUTH (verified)

/**
 * Returns the authenticated wallet for the current request, or null.
 *
 * SIWE cookie ONLY. resolveSession() validates the HMAC + expiry of the
 * tk_session cookie before returning. We deliberately do NOT accept a
 * Bearer JWT here — invitation sends are a spam-vector and must be tied
 * to a verified browser session.
 */
async function readCallerWallet(c) {
  const id = await resolveSession(c);
  if (!id || !isHexAddr(id.wallet)) return null;
  return lc(id.wallet);
}

// ──────────────────────────────────────────────────── Cookie + KV: tk_ref

/**
 * Append (NOT replace) a Set-Cookie header. Hono's c.header() defaults to
 * replace semantics, which silently clobbered the SIWE session cookie when
 * /verify chained tk_session → linkReferrerOnSignIn → tk_ref/tk_inv writes.
 * Always go through this helper so multiple cookies coexist on one response.
 */
function appendSetCookie(c, value) {
  c.header('Set-Cookie', value, { append: true });
}
function setRefCookie(c, value) {
  appendSetCookie(c, [
    `${REF_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${REF_TTL_SEC}`,
    'SameSite=Lax',
    'Secure',
  ].join('; '));
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
function clearRefCookie(c) {
  appendSetCookie(c, `${REF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`);
}
function clearInviteCookie(c) {
  appendSetCookie(c, 'tk_inv=; Path=/; Max-Age=0; Secure; SameSite=Lax');
}
function setInviteCookie(c, inviteId, email) {
  appendSetCookie(c,
    `tk_inv=${encodeURIComponent(String(inviteId) + ':' + lc(email))}; ` +
    `Path=/; Max-Age=${60 * 60 * 24 * 14}; SameSite=Lax; Secure`
  );
}

// Resolve a handle → wallet. Hex passes through; basename via Base RPC.
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

// ──────────────────────────────────── ReferralRegistry on-chain reader

const REFERRAL_REGISTRY_ABI = [
  {
    type: 'function', name: 'referrerOf', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function', name: 'hasReferrer', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event', name: 'ReferrerSet',
    inputs: [
      { name: 'user',     type: 'address', indexed: true },
      { name: 'referrer', type: 'address', indexed: true },
    ],
  },
];

function chainFor(env) {
  // Lazily required by callers that already imported viem/chains.
  return Number(env.REFERRAL_REGISTRY_CHAIN_ID || env.SUBSCRIPTION_CHAIN_ID || 8453);
}

async function viemClient(env) {
  const { createPublicClient, http } = await import('viem');
  const chains = await import('viem/chains');
  const id = chainFor(env);
  const chain = id === 84532 ? chains.baseSepolia : chains.base;
  const rpc = id === 84532
    ? (env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
    : (env.BASE_RPC_URL || 'https://mainnet.base.org');
  return createPublicClient({ chain, transport: http(rpc) });
}

async function onchainReferrerOf(env, referee) {
  if (!env.REFERRAL_REGISTRY || !isHexAddr(env.REFERRAL_REGISTRY)) return null;
  try {
    const client = await viemClient(env);
    const r = await client.readContract({
      address:      env.REFERRAL_REGISTRY,
      abi:          REFERRAL_REGISTRY_ABI,
      functionName: 'referrerOf',
      args:         [referee],
    });
    return lc(r || '0x0000000000000000000000000000000000000000');
  } catch (e) {
    console.warn('onchainReferrerOf failed:', e.message);
    return null;
  }
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ─────────────────────────────────────────────── SIWE hook: link on first sign-in

/**
 * Called from siwe.js right after a successful /verify. If the user has a
 * `tk_ref` cookie AND no existing referrer row, we insert a row in
 * status='pending'. The dashboard will then read /api/referrals/me, see the
 * `pending_link` block, prompt the user to call ReferralRegistry.setReferrer
 * from their connected wallet, and finally POST the tx hash to
 * /api/referrals/confirm-link to flip the row to 'linked'.
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
      clearRefCookie(c);
      return;
    }
    const existing = await c.env.DB.prepare(
      `SELECT id FROM referrals WHERE referee_wallet = ? LIMIT 1`
    ).bind(wallet).first();
    if (existing) {
      clearRefCookie(c);
      return;
    }
    // If the user arrived via an invite link, source = 'invite'.
    let source = 'cookie';
    let inviteId = 0;
    let inviteEmail = '';
    try {
      const raw = c.req.header('cookie') || '';
      for (const part of raw.split(/;\s*/)) {
        if (part.startsWith('tk_inv=')) {
          const dec = decodeURIComponent(part.slice('tk_inv='.length));
          const colon = dec.indexOf(':');
          if (colon > 0) {
            inviteId = Number(dec.slice(0, colon));
            inviteEmail = dec.slice(colon + 1);
            if (Number.isFinite(inviteId) && inviteId > 0) source = 'invite';
          }
          break;
        }
      }
    } catch (_) { /* ignore */ }

    await c.env.DB.prepare(
      `INSERT INTO referrals (referrer_wallet, referee_wallet, status, source, linked_at)
       VALUES (?, ?, 'pending', ?, NULL)`
    ).bind(referrer, wallet, source).run();

    // Atomically mark the invite as accepted (one-time consumption).
    if (inviteId && inviteEmail) {
      try {
        await c.env.DB.prepare(
          `UPDATE invites
              SET status = 'accepted',
                  accepted_wallet = ?,
                  accepted_at = datetime('now')
            WHERE id = ? AND email = ? AND accepted_wallet IS NULL`
        ).bind(wallet, inviteId, inviteEmail).run();
      } catch (_) { /* best-effort */ }
    }

    clearRefCookie(c);
    clearInviteCookie(c);
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

// ─────────────────────────────────────── Cloudflare Queues consumer

/**
 * Consumer for env.INVITE_QUEUE. Wired in index.js's exported queue()
 * handler. Each message body is:
 *   { inviteId, sender, email, name, fromName, message }
 *
 * On send success: UPDATE invites SET status='sent', sent_at=now.
 * On send failure: UPDATE invites SET status='failed', delivery_error=...
 * Cloudflare Queues handles retries with backoff for transient errors —
 * we call msg.retry() for network/5xx, msg.ack() for permanent failures.
 */
export async function handleInviteQueueBatch(batch, env) {
  const origin = env.PUBLIC_SITE_ORIGIN || 'https://tokenomic.org';
  for (const msg of batch.messages) {
    const m = msg.body || {};
    const { inviteId, sender, email, name, fromName, message } = m;
    if (!inviteId || !sender || !email) { msg.ack(); continue; }
    try {
      const token = await signInviteToken(env, inviteId, email, sender);
      const link  = `${origin}/r/${sender}?inv=${encodeURIComponent(token)}`;
      const unsub = `${origin}/api/invites/unsubscribe?t=${encodeURIComponent(token)}`;
      const send = await sendInviteEmail(env, {
        to: email, toName: name, fromWallet: sender, fromName,
        message, link, unsubscribeLink: unsub,
      });
      if (send.ok) {
        await env.DB.prepare(
          `UPDATE invites SET status='sent', sent_at=datetime('now') WHERE id = ?`
        ).bind(inviteId).run();
        msg.ack();
      } else {
        // Transient if MailChannels 5xx / network — let Queues retry.
        const transient = /mailchannels (5\d\d|network)/i.test(send.error || '');
        await env.DB.prepare(
          `UPDATE invites SET status=?, delivery_error=? WHERE id = ?`
        ).bind(transient ? 'queued' : 'failed', send.error || 'unknown', inviteId).run();
        if (transient) msg.retry();
        else msg.ack();
      }
    } catch (e) {
      console.warn('invite consumer error:', e.message);
      try {
        await env.DB.prepare(
          `UPDATE invites SET status='failed', delivery_error=? WHERE id = ?`
        ).bind('consumer-exception: ' + e.message, inviteId).run();
      } catch (_) {}
      msg.ack();
    }
  }
}

// ─────────────────────────────────────────────────── Contacts: Google + MS

import { getAccessToken as getOAuthAccessToken } from './oauth-calendar.js';

async function fetchGoogleContacts(env, wallet) {
  const { token } = await getOAuthAccessToken(env, wallet, 'google');
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
  const r = await env.DB.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='paid'      THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END) AS qualified_count,
        SUM(CASE WHEN status='linked'    THEN 1 ELSE 0 END) AS linked_count,
        SUM(CASE WHEN status IN ('paid','qualified') THEN reward_usdc ELSE 0 END) AS earned
       FROM referrals WHERE referrer_wallet = ?`
  ).bind(wallet).first();
  return {
    signups:        Number(r?.total || 0),
    linked:         Number(r?.linked_count || 0),
    paid:           Number(r?.paid_count || 0),
    qualified:      Number(r?.qualified_count || 0),
    usdc_earned:    Number(r?.earned || 0),
  };
}

// ────────────────────────────────────────────────────────────────── Routes

export function mountReferralRoutes(app) {
  // ----- /r/:handle ------------------------------------------------------
  // Optional `?inv=<token>` carries a one-time, HMAC-signed invite token.
  // We verify the token, mark the invite row clicked, and stash the
  // (inviteId,email) tuple in a tk_inv cookie so linkReferrerOnSignIn()
  // can flip the row to 'accepted' atomically with the SIWE link.
  app.get('/r/:handle', async (c) => {
    const handle = c.req.param('handle');
    const referrer = await resolveHandle(c.env, handle);
    const origin = c.env.PUBLIC_SITE_ORIGIN || 'https://tokenomic.org';
    if (!referrer) {
      return c.redirect(origin + '/?ref=invalid', 302);
    }
    setRefCookie(c, lc(handle));

    const invToken = c.req.query('inv') || '';
    if (invToken) {
      const verified = await verifyInviteToken(c.env, invToken);
      // Bind: the token's signed sender MUST equal the referrer derived
      // from :handle. Otherwise an attacker could replay a valid token
      // under /r/<otherHandle> to mis-attribute the referee.
      if (verified && verified.sender === referrer && c.env.DB) {
        const { inviteId, email } = verified;
        const row = await c.env.DB.prepare(
          `SELECT id, status, email, accepted_wallet, sender_wallet
             FROM invites WHERE id = ? LIMIT 1`
        ).bind(inviteId).first();
        if (row &&
            lc(row.email) === lc(email) &&
            lc(row.sender_wallet) === verified.sender &&
            !row.accepted_wallet) {
          // One-time clicked-at; repeat clicks tolerated, status never
          // demoted; final 'accepted' transition happens in linkReferrerOnSignIn.
          c.executionCtx.waitUntil(
            c.env.DB.prepare(
              `UPDATE invites
                  SET status = CASE WHEN status='queued' THEN 'clicked'
                                    WHEN status='sent'   THEN 'clicked'
                                    ELSE status END,
                      clicked_at = COALESCE(clicked_at, datetime('now'))
                WHERE id = ?`
            ).bind(inviteId).run().catch(() => {})
          );
          setInviteCookie(c, inviteId, email);
        }
      }
    }

    if (c.env.RATE_LIMIT_KV) {
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

    const recent = await c.env.DB.prepare(
      `SELECT referee_wallet, status, reward_usdc, qualified_at, paid_at, created_at
         FROM referrals
        WHERE referrer_wallet = ?
        ORDER BY created_at DESC
        LIMIT 20`
    ).bind(wallet).all();

    // Pending on-chain link surface: if THIS wallet is a referee with a
    // pending row, ask the dashboard to send setReferrer in one tx. We
    // also confirm on-chain that referrerOf(wallet) is still zero, so we
    // never re-prompt after the user has already linked.
    let pending_link = null;
    try {
      const pending = await c.env.DB.prepare(
        `SELECT referrer_wallet FROM referrals
          WHERE referee_wallet = ? AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1`
      ).bind(wallet).first();
      if (pending && isHexAddr(pending.referrer_wallet)) {
        const onchain = await onchainReferrerOf(c.env, wallet);
        if (onchain === null || onchain === ZERO_ADDR) {
          pending_link = {
            referrer:    pending.referrer_wallet,
            registry:    c.env.REFERRAL_REGISTRY || null,
            chain_id:    chainFor(c.env),
            instructions: 'Call ReferralRegistry.setReferrer(referrer) from this wallet, then POST { txHash } to /api/referrals/confirm-link.',
          };
        } else if (onchain && onchain !== ZERO_ADDR) {
          // Already linked on-chain — heal D1 lazily so the prompt goes away.
          c.executionCtx.waitUntil(
            c.env.DB.prepare(
              `UPDATE referrals SET status='linked', linked_at=datetime('now')
                WHERE referee_wallet = ? AND status='pending'`
            ).bind(wallet).run().catch(() => {})
          );
        }
      }
    } catch (e) {
      console.warn('pending_link check failed:', e.message);
    }

    const origin = c.env.PUBLIC_SITE_ORIGIN || 'https://tokenomic.org';
    const link = `${origin}/r/${wallet}`;

    return c.json({
      wallet,
      link,
      ...stats,
      pending_link,
      recent: recent?.results || [],
    });
  });

  // ----- /api/referrals/confirm-link ------------------------------------
  // POST { txHash } — verifies the receipt, asserts the referee actually
  // called ReferralRegistry.setReferrer, then flips the D1 row to 'linked'.
  app.post('/api/referrals/confirm-link', async (c) => {
    const wallet = await readCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);

    let body = {};
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body' }, 400); }
    const txHash = (body.txHash || '').toString();
    if (!isTxHash(txHash)) return c.json({ error: 'Invalid txHash' }, 400);
    if (!c.env.REFERRAL_REGISTRY || !isHexAddr(c.env.REFERRAL_REGISTRY)) {
      return c.json({ error: 'REFERRAL_REGISTRY not configured' }, 503);
    }

    let onchainReferrer;
    try {
      const client = await viemClient(c.env);
      // Wait for the receipt to be mined (short polling — 8s budget).
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash, timeout: 8_000, pollingInterval: 1_000,
      }).catch(() => null);
      if (!receipt || receipt.status !== 'success') {
        return c.json({ error: 'Transaction not confirmed or reverted' }, 422);
      }
      // The referee must be the one who submitted setReferrer.
      if (lc(receipt.from) !== wallet) {
        return c.json({ error: 'Transaction sender does not match session wallet' }, 403);
      }
      // Re-read the contract to confirm the bind happened — handles
      // cases where the user called the wrong contract or ABI.
      onchainReferrer = await onchainReferrerOf(c.env, wallet);
      if (!onchainReferrer || onchainReferrer === ZERO_ADDR) {
        return c.json({ error: 'On-chain referrer is still zero after tx — wrong contract?' }, 422);
      }
    } catch (e) {
      return c.json({ error: 'Receipt lookup failed: ' + e.message }, 502);
    }

    // Update / create the D1 row authoritatively from on-chain truth.
    const existing = await c.env.DB.prepare(
      `SELECT id, referrer_wallet FROM referrals WHERE referee_wallet = ? LIMIT 1`
    ).bind(wallet).first();

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE referrals
            SET referrer_wallet = ?, status='linked', linked_at=datetime('now'),
                link_tx_hash = ?
          WHERE id = ?`
      ).bind(onchainReferrer, txHash, existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO referrals (referrer_wallet, referee_wallet, status, source, linked_at, link_tx_hash)
         VALUES (?, ?, 'linked', 'on-chain', datetime('now'), ?)`
      ).bind(onchainReferrer, wallet, txHash).run();
    }
    return c.json({ ok: true, referrer: onchainReferrer, txHash });
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
  // PRODUCER. Validates input + Turnstile + caps + dedupe + suppression,
  // inserts D1 invite rows in 'queued' state, then enqueues a message per
  // recipient onto INVITE_QUEUE. The consumer (handleInviteQueueBatch) does
  // the actual MailChannels send and updates the row.
  app.post('/api/referrals/invite-batch', async (c) => {
    const wallet = await readCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);
    if (!inviteKey(c.env)) return c.json({ error: 'INVITE_HMAC_KEY not configured' }, 503);
    if (!c.env.INVITE_QUEUE) return c.json({ error: 'INVITE_QUEUE binding not configured' }, 503);

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

    const emails = [];
    for (const r of body.recipients) {
      const e = lc(clean(r.email || '', 254));
      if (isEmail(e)) emails.push({ email: e, name: clean(r.name || '', 100) });
    }
    if (emails.length === 0) return c.json({ error: 'No valid emails in recipients' }, 400);

    const seen = new Set();
    const unique = emails.filter((r) => seen.has(r.email) ? false : (seen.add(r.email), true));

    const placeholders = unique.map(() => '?').join(',');
    const suppRows = await c.env.DB.prepare(
      `SELECT email FROM invite_suppressions WHERE email IN (${placeholders})`
    ).bind(...unique.map((r) => r.email)).all();
    const suppressed = new Set((suppRows?.results || []).map((r) => r.email));

    const recentRows = await c.env.DB.prepare(
      `SELECT email FROM invites
        WHERE sender_wallet = ?
          AND email IN (${placeholders})
          AND created_at >= datetime('now','-${DEDUPE_DAYS} days')`
    ).bind(wallet, ...unique.map((r) => r.email)).all();
    const recentlyInvited = new Set((recentRows?.results || []).map((r) => r.email));

    const results = [];
    const queueMessages = [];

    for (const r of unique) {
      if (suppressed.has(r.email)) {
        results.push({ email: r.email, status: 'suppressed' });
        continue;
      }
      if (recentlyInvited.has(r.email)) {
        results.push({ email: r.email, status: 'duplicate' });
        continue;
      }

      const ins = await c.env.DB.prepare(
        `INSERT INTO invites (sender_wallet, email, name, message, source, token_prefix, status)
         VALUES (?, ?, ?, ?, ?, '', 'queued')`
      ).bind(wallet, r.email, r.name || null, personalMessage || null, source).run();
      const inviteId = Number(ins.meta?.last_row_id || 0);
      if (!inviteId) {
        results.push({ email: r.email, status: 'failed', error: 'db-insert-failed' });
        continue;
      }
      const token = await signInviteToken(c.env, inviteId, r.email, wallet);
      const tokenPrefix = token.slice(0, 16);
      await c.env.DB.prepare(
        `UPDATE invites SET token_prefix = ? WHERE id = ?`
      ).bind(tokenPrefix, inviteId).run();

      queueMessages.push({
        body: {
          inviteId, sender: wallet, email: r.email, name: r.name || '',
          fromName, message: personalMessage,
        },
      });
      results.push({ email: r.email, status: 'queued', inviteId });
    }

    // Batch-enqueue. sendBatch is preferred when many messages.
    if (queueMessages.length) {
      try {
        if (typeof c.env.INVITE_QUEUE.sendBatch === 'function') {
          await c.env.INVITE_QUEUE.sendBatch(queueMessages);
        } else {
          for (const m of queueMessages) await c.env.INVITE_QUEUE.send(m.body);
        }
      } catch (e) {
        // If the queue write fails, mark those rows as failed so the
        // dashboard reflects reality. The consumer will not see them.
        const failedIds = queueMessages.map((m) => m.body.inviteId);
        const ph = failedIds.map(() => '?').join(',');
        await c.env.DB.prepare(
          `UPDATE invites SET status='failed', delivery_error=? WHERE id IN (${ph})`
        ).bind('queue-enqueue-failed: ' + e.message, ...failedIds).run().catch(() => {});
        return c.json({ error: 'Queue enqueue failed: ' + e.message }, 502);
      }
    }

    const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    return c.json({ ok: true, summary, results });
  });

  // ----- /api/invites/unsubscribe (GET) ---------------------------------
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
