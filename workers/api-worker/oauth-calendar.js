/**
 * Phase 4 — Calendar OAuth + unified availability layer.
 *
 * Providers:
 *   - google    Google Calendar (OAuth 2.0, offline access, freebusy, events.insert)
 *   - microsoft Outlook via Microsoft Graph (OAuth 2.0, calendars.readwrite,
 *               /me/calendar/getSchedule, /me/events)
 *   - calendly  Read-only (scheduled_events) + webhook ingest of invitee.created
 *               and invitee.canceled, persisted into the same `bookings` table.
 *
 * Refresh tokens are encrypted at rest with AES-GCM using a 256-bit
 * Workers Secret `OAUTH_TOKEN_ENC_KEY` (raw base64). Plaintext tokens
 * never leave this module's local scope and are never logged.
 *
 * The OAuth callback target MUST be the deployed Worker — local Express
 * cannot terminate the redirect. The "start" endpoint signs an HMAC state
 * containing { wallet, provider, return_to, nonce, exp } so the callback
 * can identify the originating wallet without trusting client cookies.
 */

import { readSessionFromCookie } from './siwe.js';

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────

function isHexAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}
function lc(s) { return (s || '').toString().toLowerCase(); }
function nowSec() { return Math.floor(Date.now() / 1000); }

function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/')
    + '=='.slice((String(str || '').length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

// ────────────────────────────────────────────────────────────────────────────
// AES-GCM encryption for refresh tokens at rest
// ────────────────────────────────────────────────────────────────────────────

async function importEncKey(env) {
  const raw = env.OAUTH_TOKEN_ENC_KEY;
  if (!raw) throw new Error('OAUTH_TOKEN_ENC_KEY not configured');
  let bytes;
  try {
    bytes = b64urlDecode(raw.replace(/=+$/, ''));
  } catch {
    throw new Error('OAUTH_TOKEN_ENC_KEY must be base64url-encoded 32 bytes');
  }
  if (bytes.length !== 32) {
    throw new Error('OAUTH_TOKEN_ENC_KEY must decode to exactly 32 bytes');
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false,
    ['encrypt', 'decrypt']);
}

async function encryptToken(env, plaintext) {
  if (plaintext == null) return null;
  const key = await importEncKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plaintext))
  ));
  // Format: v1:<iv-b64u>:<ct-b64u>
  return `v1:${b64urlEncode(iv)}:${b64urlEncode(ct)}`;
}

async function decryptToken(env, blob) {
  if (!blob) return null;
  const parts = String(blob).split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Bad encrypted token format');
  }
  const iv = b64urlDecode(parts[1]);
  const ct = b64urlDecode(parts[2]);
  const key = await importEncKey(env);
  const pt = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, ct
  ));
  return new TextDecoder().decode(pt);
}

// ────────────────────────────────────────────────────────────────────────────
// HMAC-signed OAuth state
// ────────────────────────────────────────────────────────────────────────────

function stateSecret(env) {
  // Never fall back to a hardcoded value: a forgeable state would let an
  // attacker bind their calendar to a victim's wallet via CSRF.
  const s = env.SIWE_SECRET || env.JWT_SECRET;
  if (!s) throw new Error('SIWE_SECRET or JWT_SECRET must be configured');
  return s;
}

async function signState(env, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(stateSecret(env), body);
  return `${body}.${sig}`;
}

async function verifyState(env, token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig  = token.slice(idx + 1);
  const expect = await hmac(stateSecret(env), body);
  // constant-time compare
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))); }
  catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.exp && payload.exp < nowSec()) return null;
  return payload;
}

// ────────────────────────────────────────────────────────────────────────────
// auth resolution (SIWE cookie OR Bearer JWT)
//
// We can't reuse d1-routes' requireAuth here without a circular import; use
// a small adapter that prefers the cookie session and falls back to JWT.
// ────────────────────────────────────────────────────────────────────────────

async function resolveCallerWallet(c) {
  const cookieSess = await readSessionFromCookie(c);
  if (cookieSess && cookieSess.wallet && isHexAddress(cookieSess.wallet)) {
    return lc(cookieSess.wallet);
  }
  const auth = c.req.header('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
        if (payload && payload.wallet && isHexAddress(payload.wallet)) {
          return lc(payload.wallet);
        }
      } catch { /* fall through */ }
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Provider config
// ────────────────────────────────────────────────────────────────────────────

const PROVIDERS = ['google', 'microsoft', 'calendly'];

function callbackUrl(c, provider) {
  const url = new URL(c.req.url);
  return `${url.origin}/api/oauth/${provider}/callback`;
}

function providerConfig(env, provider) {
  switch (provider) {
    case 'google':
      return {
        clientId:     env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        authUrl:  'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes:   ['https://www.googleapis.com/auth/calendar.events',
                   'https://www.googleapis.com/auth/calendar.readonly',
                   'openid', 'email'],
        extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
      };
    case 'microsoft': {
      const tenant = env.MS_OAUTH_TENANT || 'common';
      return {
        clientId:     env.MS_OAUTH_CLIENT_ID,
        clientSecret: env.MS_OAUTH_CLIENT_SECRET,
        authUrl:  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        scopes:   ['offline_access', 'openid', 'email',
                   'Calendars.ReadWrite', 'User.Read'],
        extra: { response_mode: 'query', prompt: 'select_account' },
      };
    }
    case 'calendly':
      return {
        clientId:     env.CALENDLY_OAUTH_CLIENT_ID,
        clientSecret: env.CALENDLY_OAUTH_CLIENT_SECRET,
        authUrl:  'https://auth.calendly.com/oauth/authorize',
        tokenUrl: 'https://auth.calendly.com/oauth/token',
        scopes:   ['default'],
        extra: {},
      };
    default:
      return null;
  }
}

function isProviderConfigured(env, provider) {
  const cfg = providerConfig(env, provider);
  return !!(cfg && cfg.clientId && cfg.clientSecret && env.OAUTH_TOKEN_ENC_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// Token exchange + refresh
// ────────────────────────────────────────────────────────────────────────────

async function exchangeCode(env, provider, code, redirectUri) {
  const cfg = providerConfig(env, provider);
  if (!cfg) throw new Error('Unknown provider');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const r = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data && (data.error_description || data.error)) || `HTTP ${r.status}`;
    throw new Error(`Token exchange failed: ${msg}`);
  }
  return data; // { access_token, refresh_token, expires_in, scope, token_type, ... }
}

async function refreshAccessToken(env, provider, refreshToken) {
  const cfg = providerConfig(env, provider);
  if (!cfg) throw new Error('Unknown provider');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const r = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Refresh failed: ${(data && data.error) || r.status}`);
  }
  return data;
}

/**
 * Load the connection row, decrypt+refresh if needed, and return a usable
 * access token. Persists rotated refresh tokens transparently.
 */
async function getAccessToken(env, wallet, provider) {
  async function readRow() {
    return env.DB.prepare(
      `SELECT id, refresh_token_enc, access_token_enc, expires_at, external_account_id, external_calendar_id, scope
         FROM availability_providers
        WHERE wallet = ? AND provider = ? AND status = 'connected'
        ORDER BY id DESC LIMIT 1`
    ).bind(lc(wallet), provider).first();
  }

  let row = await readRow();
  if (!row) throw new Error(`No ${provider} connection for ${wallet}`);

  const expiresMs = row.expires_at ? Date.parse(row.expires_at) : 0;
  const stillValid = expiresMs && (expiresMs - Date.now() > 60_000);
  if (stillValid && row.access_token_enc) {
    try { return { token: await decryptToken(env, row.access_token_enc), row }; }
    catch { /* fall through to refresh */ }
  }
  if (!row.refresh_token_enc) {
    throw new Error(`Cannot refresh ${provider}: no refresh token on file`);
  }
  const originalRefreshEnc = row.refresh_token_enc;
  const refresh = await decryptToken(env, row.refresh_token_enc);

  let td;
  try {
    td = await refreshAccessToken(env, provider, refresh);
  } catch (err) {
    // Race-condition recovery: if a concurrent request already rotated the
    // refresh token, our copy is now stale and the provider returned
    // invalid_grant. Re-read the row; if the stored refresh_token_enc has
    // changed since we started, surface the freshly-cached access token.
    const fresh = await readRow();
    if (fresh && fresh.refresh_token_enc !== originalRefreshEnc && fresh.access_token_enc) {
      const fExpMs = fresh.expires_at ? Date.parse(fresh.expires_at) : 0;
      if (fExpMs && fExpMs - Date.now() > 60_000) {
        try { return { token: await decryptToken(env, fresh.access_token_enc), row: fresh }; }
        catch { /* fall through to throw */ }
      }
    }
    throw err;
  }

  const newAccessEnc = await encryptToken(env, td.access_token);
  // Some providers rotate refresh tokens — persist the new one if present.
  const newRefreshEnc = td.refresh_token
    ? await encryptToken(env, td.refresh_token)
    : row.refresh_token_enc;
  const newExpires = td.expires_in
    ? new Date(Date.now() + (Number(td.expires_in) - 30) * 1000).toISOString()
    : null;
  // Compare-and-swap on the original refresh token blob so a concurrent
  // refresh that already won doesn't get overwritten with our (now stale)
  // result. If 0 rows updated, the other writer already persisted; just
  // return the access token we just minted (still valid for ~1h).
  await env.DB.prepare(
    `UPDATE availability_providers
        SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, updated_at = datetime('now')
      WHERE id = ? AND refresh_token_enc = ?`
  ).bind(newAccessEnc, newRefreshEnc, newExpires, row.id, originalRefreshEnc).run();
  return { token: td.access_token, row };
}

// ────────────────────────────────────────────────────────────────────────────
// Provider-specific calls (free/busy + create event)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns an array of busy intervals: [{ start: ISO, end: ISO }]
 */
async function getBusyIntervals(env, wallet, provider, startISO, endISO) {
  const { token, row } = await getAccessToken(env, wallet, provider);

  if (provider === 'google') {
    const calId = row.external_calendar_id || 'primary';
    const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        timeMin: startISO, timeMax: endISO, items: [{ id: calId }],
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Google freeBusy failed: ${d.error?.message || r.status}`);
    const cal = d.calendars && d.calendars[calId];
    return (cal && cal.busy) || [];
  }

  if (provider === 'microsoft') {
    // /me/calendar/getSchedule needs an email/UPN. Fall back to "me".
    const upn = row.external_account_id || 'me';
    const r = await fetch('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schedules: [upn],
        startTime: { dateTime: startISO, timeZone: 'UTC' },
        endTime:   { dateTime: endISO,   timeZone: 'UTC' },
        availabilityViewInterval: 15,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Graph getSchedule failed: ${d.error?.message || r.status}`);
    const sched = (d.value && d.value[0]) || {};
    return (sched.scheduleItems || []).map(it => ({
      start: it.start?.dateTime ? new Date(it.start.dateTime + 'Z').toISOString() : it.start,
      end:   it.end?.dateTime   ? new Date(it.end.dateTime + 'Z').toISOString()   : it.end,
    }));
  }

  if (provider === 'calendly') {
    // Calendly: we treat scheduled_events as busy. Requires the user URI.
    let userUri = row.external_account_id;
    if (!userUri) {
      const me = await fetch('https://api.calendly.com/users/me', {
        headers: { authorization: `Bearer ${token}` },
      }).then(r => r.json()).catch(() => ({}));
      userUri = me?.resource?.uri;
      if (userUri) {
        await env.DB.prepare(
          `UPDATE availability_providers SET external_account_id = ? WHERE id = ?`
        ).bind(userUri, row.id).run();
      }
    }
    if (!userUri) return [];
    const url = new URL('https://api.calendly.com/scheduled_events');
    url.searchParams.set('user', userUri);
    url.searchParams.set('min_start_time', startISO);
    url.searchParams.set('max_start_time', endISO);
    url.searchParams.set('status', 'active');
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Calendly events failed: ${d.message || r.status}`);
    return (d.collection || []).map(ev => ({
      start: ev.start_time, end: ev.end_time,
    }));
  }

  return [];
}

/**
 * Create an event on the consultant's primary calendar. Returns
 * { externalEventId, meetingUrl }. Falls back gracefully on Calendly
 * (no programmatic event creation API for arbitrary slots).
 */
async function createCalendarEvent(env, wallet, provider, eventInput) {
  const { token, row } = await getAccessToken(env, wallet, provider);
  const { startISO, endISO, title, description, attendeeEmail } = eventInput;

  if (provider === 'google') {
    const calId = row.external_calendar_id || 'primary';
    const body = {
      summary: title,
      description,
      start: { dateTime: startISO },
      end:   { dateTime: endISO },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Google events.insert failed: ${d.error?.message || r.status}`);
    return {
      externalEventId: d.id,
      meetingUrl: d.hangoutLink || (d.conferenceData?.entryPoints?.[0]?.uri) || d.htmlLink || null,
    };
  }

  if (provider === 'microsoft') {
    const body = {
      subject: title,
      body: { contentType: 'text', content: description || '' },
      start: { dateTime: startISO, timeZone: 'UTC' },
      end:   { dateTime: endISO,   timeZone: 'UTC' },
      attendees: attendeeEmail
        ? [{ emailAddress: { address: attendeeEmail }, type: 'required' }]
        : [],
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    };
    const r = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Graph events failed: ${d.error?.message || r.status}`);
    return {
      externalEventId: d.id,
      meetingUrl: d.onlineMeeting?.joinUrl || d.webLink || null,
    };
  }

  if (provider === 'calendly') {
    // Calendly does not expose an API to create one-off events programmatically.
    // We return null externalEventId; the booking row still records the slot
    // in D1 and the Calendly webhook will reconcile when the invitee confirms
    // through Calendly's own UI.
    return { externalEventId: null, meetingUrl: null };
  }

  return { externalEventId: null, meetingUrl: null };
}

/**
 * Best-effort compensating delete used when a booking insert loses an
 * overlap race after we already created the calendar event. Failures
 * are non-fatal — the orphaned event will at worst show on the
 * consultant's calendar until they remove it manually.
 */
async function deleteCalendarEvent(env, wallet, provider, externalEventId) {
  if (!externalEventId) return;
  const { token, row } = await getAccessToken(env, wallet, provider);
  if (provider === 'google') {
    const calId = row.external_calendar_id || 'primary';
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=all`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
    );
  } else if (provider === 'microsoft') {
    await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(externalEventId)}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
    );
  }
  // Calendly events are not created programmatically, so nothing to delete.
}

// ────────────────────────────────────────────────────────────────────────────
// Unified availability — merge busy across providers, emit free slots
// ────────────────────────────────────────────────────────────────────────────

function mergeIntervals(intervals) {
  const sorted = intervals
    .map(i => [Date.parse(i.start), Date.parse(i.end)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of sorted) {
    if (!merged.length || a > merged[merged.length - 1][1]) merged.push([a, b]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
  }
  return merged;
}

/**
 * Generate 15-minute free slots inside business hours (09:00–18:00 UTC for
 * v1; consultants can later store per-provider working hours in
 * availability_providers.metadata).
 */
function generateFreeSlots(busyMerged, startMs, endMs, opts) {
  const slotMin   = (opts && opts.slotMinutes) || 15;
  const slotMs    = slotMin * 60_000;
  const wkStart   = (opts && opts.workdayStartHour) || 9;
  const wkEnd     = (opts && opts.workdayEndHour)   || 18;
  const out = [];
  let cursor = startMs;
  let bi = 0;
  while (cursor + slotMs <= endMs) {
    const d = new Date(cursor);
    const hour = d.getUTCHours();
    const day  = d.getUTCDay(); // 0 Sun .. 6 Sat
    const inWindow = day >= 1 && day <= 5 && hour >= wkStart && hour < wkEnd;
    if (!inWindow) { cursor += slotMs; continue; }
    // advance bi past intervals that end before cursor
    while (bi < busyMerged.length && busyMerged[bi][1] <= cursor) bi++;
    const overlap = bi < busyMerged.length
      && busyMerged[bi][0] < cursor + slotMs
      && busyMerged[bi][1] > cursor;
    if (!overlap) {
      out.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + slotMs).toISOString() });
    }
    cursor += slotMs;
  }
  return out;
}

async function getUnifiedAvailability(env, wallet, startISO, endISO, opts) {
  const startMs = Date.parse(startISO);
  const endMs   = Date.parse(endISO);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('Invalid date range');
  }
  const cacheKey = `avail:${lc(wallet)}:${startISO}:${endISO}:${(opts && opts.slotMinutes) || 15}`;
  if (env.RATE_LIMIT_KV) {
    try {
      const cached = await env.RATE_LIMIT_KV.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}
  }

  const { results } = await env.DB.prepare(
    `SELECT provider FROM availability_providers
      WHERE wallet = ? AND status = 'connected'`
  ).bind(lc(wallet)).all();
  const providers = (results || []).map(r => r.provider);

  let allBusy = [];
  const errors = [];
  for (const p of providers) {
    try {
      const busy = await getBusyIntervals(env, wallet, p, startISO, endISO);
      allBusy = allBusy.concat(busy);
    } catch (e) {
      errors.push({ provider: p, error: e.message });
    }
  }

  // Already-confirmed bookings in D1 are also busy — even if no calendar
  // is connected we still want to block double-bookings.
  const { results: locallyBusy } = await env.DB.prepare(
    `SELECT booking_date AS start, ends_at AS end
       FROM bookings
      WHERE consultant_wallet = ?
        AND status IN ('pending','confirmed')
        AND booking_date IS NOT NULL`
  ).bind(lc(wallet)).all();
  for (const b of (locallyBusy || [])) {
    if (b.start && b.end) allBusy.push({ start: b.start, end: b.end });
  }

  const merged = mergeIntervals(allBusy);
  const slots  = generateFreeSlots(merged, startMs, endMs, opts);
  const result = { providers, slots, errors, generatedAt: new Date().toISOString() };
  if (env.RATE_LIMIT_KV) {
    try {
      await env.RATE_LIMIT_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 });
    } catch {}
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Calendly webhook signature verification (HMAC-SHA256)
// ────────────────────────────────────────────────────────────────────────────

async function verifyCalendlySignature(env, header, rawBody) {
  const key = env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!key) return false;
  // Calendly header format: "t=1700000000,v1=hex_signature"
  const parts = String(header || '').split(',').map(s => s.trim());
  const tPart = parts.find(p => p.startsWith('t='));
  const vPart = parts.find(p => p.startsWith('v1='));
  if (!tPart || !vPart) return false;
  const t = tPart.slice(2);
  const v = vPart.slice(3);
  const data = `${t}.${rawBody}`;
  const importedKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', importedKey,
    new TextEncoder().encode(data)));
  const hex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== v.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v.charCodeAt(i);
  return diff === 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Route mounting
// ────────────────────────────────────────────────────────────────────────────

export function mountCalendarRoutes(app) {

  // Status endpoint — what's connected for the caller (or a queried wallet
  // for the public booking widget; refresh tokens are NEVER returned).
  app.get('/api/calendar/connections', async (c) => {
    if (!c.env.DB) return c.json({ error: 'D1 not bound' }, 503);
    const wallet = await resolveCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);
    const { results } = await c.env.DB.prepare(
      `SELECT provider, external_account_id, external_calendar_id,
              scope, status, created_at, updated_at
         FROM availability_providers
        WHERE wallet = ? ORDER BY created_at DESC`
    ).bind(wallet).all();
    return c.json({
      wallet,
      providers: PROVIDERS.map(p => ({
        provider: p,
        configured: isProviderConfigured(c.env, p),
      })),
      connections: results || [],
    });
  });

  // Public — just booleans of which providers a consultant has connected,
  // so the booking widget can show "calendar-backed availability" UX.
  app.get('/api/calendar/public-status/:wallet', async (c) => {
    if (!c.env.DB) return c.json({ error: 'D1 not bound' }, 503);
    const w = lc(c.req.param('wallet'));
    if (!isHexAddress(w)) return c.json({ error: 'Invalid wallet' }, 400);
    const { results } = await c.env.DB.prepare(
      `SELECT provider FROM availability_providers
        WHERE wallet = ? AND status = 'connected'`
    ).bind(w).all();
    return c.json({
      wallet: w,
      providers: (results || []).map(r => r.provider),
    });
  });

  // OAuth start — issues a redirect to the provider with a signed state.
  app.get('/api/oauth/:provider/start', async (c) => {
    const provider = c.req.param('provider');
    if (!PROVIDERS.includes(provider)) return c.json({ error: 'Unknown provider' }, 404);
    if (!isProviderConfigured(c.env, provider)) {
      return c.json({
        error: `${provider} OAuth not configured (missing client id/secret or OAUTH_TOKEN_ENC_KEY)`
      }, 503);
    }
    const wallet = await resolveCallerWallet(c);
    if (!wallet) return c.json({ error: 'Sign in with your wallet first' }, 401);

    const cfg = providerConfig(c.env, provider);
    const returnTo = c.req.query('return_to') || '/profile/';
    const state = await signState(c.env, {
      wallet, provider, return_to: String(returnTo).slice(0, 256),
      nonce: crypto.randomUUID(), exp: nowSec() + 600,
    });
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: callbackUrl(c, provider),
      response_type: 'code',
      scope: cfg.scopes.join(' '),
      state,
      ...cfg.extra,
    });
    return c.redirect(`${cfg.authUrl}?${params.toString()}`, 302);
  });

  // OAuth callback — exchange code, encrypt+persist tokens, redirect home.
  app.get('/api/oauth/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    if (!PROVIDERS.includes(provider)) return c.json({ error: 'Unknown provider' }, 404);
    const url = new URL(c.req.url);
    const code   = url.searchParams.get('code');
    const stateQ = url.searchParams.get('state');
    const errQ   = url.searchParams.get('error');
    const allowedOrigin = c.env.PUBLIC_SITE_ORIGIN || '';
    if (errQ) {
      return c.html(renderCallbackPage({ ok: false, message: `Provider error: ${errQ}`, allowedOrigin }));
    }
    if (!code || !stateQ) {
      return c.html(renderCallbackPage({ ok: false, message: 'Missing code or state', allowedOrigin }));
    }
    const state = await verifyState(c.env, stateQ);
    if (!state || state.provider !== provider || !isHexAddress(state.wallet)) {
      return c.html(renderCallbackPage({ ok: false, message: 'Invalid or expired state', allowedOrigin }));
    }
    let td;
    try {
      td = await exchangeCode(c.env, provider, code, callbackUrl(c, provider));
    } catch (e) {
      return c.html(renderCallbackPage({ ok: false, message: e.message, allowedOrigin }));
    }
    const accessEnc  = td.access_token  ? await encryptToken(c.env, td.access_token)  : null;
    const refreshEnc = td.refresh_token ? await encryptToken(c.env, td.refresh_token) : null;
    const expires    = td.expires_in
      ? new Date(Date.now() + (Number(td.expires_in) - 30) * 1000).toISOString()
      : null;

    // Best-effort: capture provider-side identity for getSchedule / scheduled_events.
    let externalAccountId = null;
    let externalCalendarId = null;
    try {
      if (provider === 'google') {
        const me = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary', {
          headers: { authorization: `Bearer ${td.access_token}` },
        }).then(r => r.json()).catch(() => null);
        externalCalendarId = me?.id || null;
        externalAccountId  = me?.id || null;
      } else if (provider === 'microsoft') {
        const me = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { authorization: `Bearer ${td.access_token}` },
        }).then(r => r.json()).catch(() => null);
        externalAccountId = me?.userPrincipalName || me?.mail || null;
      } else if (provider === 'calendly') {
        const me = await fetch('https://api.calendly.com/users/me', {
          headers: { authorization: `Bearer ${td.access_token}` },
        }).then(r => r.json()).catch(() => null);
        externalAccountId = me?.resource?.uri || null;
      }
    } catch { /* non-fatal */ }

    await c.env.DB.prepare(
      `INSERT INTO availability_providers
         (wallet, provider, external_account_id, external_calendar_id,
          access_token_enc, refresh_token_enc, scope, expires_at, status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', datetime('now'), datetime('now'))
       ON CONFLICT(wallet, provider, external_account_id) DO UPDATE SET
         access_token_enc  = excluded.access_token_enc,
         refresh_token_enc = COALESCE(excluded.refresh_token_enc, refresh_token_enc),
         scope             = excluded.scope,
         expires_at        = excluded.expires_at,
         status            = 'connected',
         external_calendar_id = excluded.external_calendar_id,
         updated_at        = datetime('now')`
    ).bind(
      state.wallet, provider, externalAccountId, externalCalendarId,
      accessEnc, refreshEnc, td.scope || null, expires
    ).run();

    return c.html(renderCallbackPage({
      ok: true, provider,
      message: `${provider} connected successfully.`,
      returnTo: state.return_to || '/profile/',
      allowedOrigin: c.env.PUBLIC_SITE_ORIGIN || '',
    }));
  });

  // Disconnect a provider for the authenticated caller.
  app.post('/api/oauth/:provider/disconnect', async (c) => {
    const provider = c.req.param('provider');
    if (!PROVIDERS.includes(provider)) return c.json({ error: 'Unknown provider' }, 404);
    const wallet = await resolveCallerWallet(c);
    if (!wallet) return c.json({ error: 'Unauthorized' }, 401);
    await c.env.DB.prepare(
      `UPDATE availability_providers SET status = 'revoked', updated_at = datetime('now')
        WHERE wallet = ? AND provider = ?`
    ).bind(wallet, provider).run();
    return c.json({ ok: true, provider });
  });

  // Public availability — slots for a given consultant within [from, to).
  app.get('/api/availability/:wallet', async (c) => {
    if (!c.env.DB) return c.json({ error: 'D1 not bound' }, 503);
    const wallet = lc(c.req.param('wallet'));
    if (!isHexAddress(wallet)) return c.json({ error: 'Invalid wallet' }, 400);
    const url = new URL(c.req.url);
    const from = url.searchParams.get('from')
      || new Date().toISOString();
    const to   = url.searchParams.get('to')
      || new Date(Date.now() + 7 * 86400_000).toISOString();
    const slotMinutes = Math.max(15, Math.min(120,
      parseInt(url.searchParams.get('slot') || '15', 10)));
    try {
      const data = await getUnifiedAvailability(c.env, wallet, from, to, { slotMinutes });
      return c.json({ wallet, from, to, ...data });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });

  // Hold a slot for 15 minutes (lightweight KV reservation, not a DB row).
  // Prevents two buyers from racing to book the same slot during checkout.
  app.post('/api/bookings/hold', async (c) => {
    if (!c.env.RATE_LIMIT_KV) return c.json({ error: 'KV not bound' }, 503);
    const buyer = await resolveCallerWallet(c);
    if (!buyer) return c.json({ error: 'Sign in to hold a slot' }, 401);
    let body = {}; try { body = await c.req.json(); } catch {}
    const consultant = lc(body.consultant_wallet || '');
    const start = body.start_iso;
    const end   = body.end_iso;
    if (!isHexAddress(consultant)) return c.json({ error: 'Invalid consultant_wallet' }, 400);
    if (!start || !end || Date.parse(start) >= Date.parse(end)) {
      return c.json({ error: 'Invalid time range' }, 400);
    }
    const key = `hold:${consultant}:${start}`;
    const existing = await c.env.RATE_LIMIT_KV.get(key);
    if (existing && existing !== buyer) {
      return c.json({ error: 'Slot is being held by another buyer; try again shortly' }, 409);
    }
    await c.env.RATE_LIMIT_KV.put(key, buyer, { expirationTtl: 15 * 60 });
    return c.json({
      ok: true,
      hold: { consultant, start, end, buyer, expiresInSec: 15 * 60 },
    });
  });

  // Confirm booking — writes to D1, attempts to write to consultant's
  // primary calendar provider, releases the hold.
  app.post('/api/bookings/confirm', async (c) => {
    if (!c.env.DB) return c.json({ error: 'D1 not bound' }, 503);
    const buyer = await resolveCallerWallet(c);
    if (!buyer) return c.json({ error: 'Sign in to confirm' }, 401);
    let body = {}; try { body = await c.req.json(); } catch {}
    const consultant = lc(body.consultant_wallet || '');
    const start = body.start_iso, end = body.end_iso;
    if (!isHexAddress(consultant)) return c.json({ error: 'Invalid consultant_wallet' }, 400);
    if (!start || !end) return c.json({ error: 'Missing start/end' }, 400);

    const topic   = String(body.topic || '').slice(0, 200);
    const cname   = String(body.client_name || '').slice(0, 100);
    const cemail  = String(body.client_email || '').slice(0, 200);
    const price   = Number(body.price_usdc || 0);
    const txHash  = body.payment_tx_hash ? String(body.payment_tx_hash).slice(0, 80) : null;
    const durMin  = Math.max(15, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));

    // Pick the consultant's primary calendar provider. Preference order:
    // google → microsoft → calendly → none (D1-only).
    const { results: provs } = await c.env.DB.prepare(
      `SELECT provider FROM availability_providers
        WHERE wallet = ? AND status = 'connected'`
    ).bind(consultant).all();
    const conn = (provs || []).map(r => r.provider);
    const primary = ['google', 'microsoft', 'calendly'].find(p => conn.includes(p)) || null;

    // Verify the hold (if any) belongs to this buyer BEFORE we touch the
    // consultant's calendar — otherwise a losing buyer would create an
    // orphan event for a booking that never lands in D1. Missing hold is
    // tolerated (client may have skipped /hold); a hold owned by someone
    // else is rejected.
    if (c.env.RATE_LIMIT_KV) {
      try {
        const holder = await c.env.RATE_LIMIT_KV.get(`hold:${consultant}:${start}`);
        if (holder && holder !== buyer) {
          return c.json({ error: 'Slot is held by another buyer — try again shortly.' }, 409);
        }
      } catch { /* KV transient — fall through */ }
    }

    let externalEventId = null, meetingUrl = null;
    if (primary && primary !== 'calendly') {
      try {
        const ev = await createCalendarEvent(c.env, consultant, primary, {
          startISO: start, endISO: end,
          title: `Tokenomic consult: ${topic || 'session'}`,
          description: `Booked by ${cname || buyer} via Tokenomic.\nTx: ${txHash || '(no on-chain payment)'}`,
          attendeeEmail: cemail || undefined,
        });
        externalEventId = ev.externalEventId;
        meetingUrl = ev.meetingUrl;
      } catch (e) {
        // Don't fail the booking — record it locally and surface a warning.
        console.warn('createCalendarEvent failed:', e.message);
      }
    }

    // Atomic insert: a single statement performs the overlap check and the
    // write together via INSERT ... SELECT ... WHERE NOT EXISTS, so two
    // concurrent confirms for the same slot can never both succeed even
    // if their reads interleave. SQLite/D1 serializes writes against the
    // same DB, and INSERT-SELECT executes the WHERE NOT EXISTS subquery
    // and the row write inside the same write transaction.
    const status = txHash ? 'confirmed' : 'pending';
    const timeSlot = new Date(start).toISOString().slice(11, 16);
    const res = await c.env.DB.prepare(
      `INSERT INTO bookings
         (consultant_wallet, client_wallet, client_name, topic,
          booking_date, time_slot, duration, price_usdc, status,
          provider, external_event_id, meeting_url, ends_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings
           WHERE consultant_wallet = ?
             AND status IN ('pending','confirmed')
             AND booking_date IS NOT NULL AND ends_at IS NOT NULL
             AND booking_date < ?
             AND ends_at      > ?
        )`
    ).bind(
      consultant, buyer, cname, topic,
      start, timeSlot, durMin, price, status,
      primary, externalEventId, meetingUrl, end,
      // overlap-check params:
      consultant, end, start
    ).run();
    const inserted = res.meta && (res.meta.changes || res.meta.changed_db) ? res.meta.changes : 0;
    if (!inserted) {
      // The write was rejected by the WHERE NOT EXISTS guard — another
      // confirm landed first. If we already wrote a calendar event, try
      // to roll it back so we don't leave an orphaned meeting on the
      // consultant's calendar.
      if (externalEventId && primary && primary !== 'calendly') {
        try { await deleteCalendarEvent(c.env, consultant, primary, externalEventId); }
        catch (e) { console.warn('Compensating calendar delete failed:', e.message); }
      }
      return c.json({ error: 'Slot is no longer available — please pick another time.' }, 409);
    }
    const id = res.meta && res.meta.last_row_id;
    const row = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();

    // Release the hold, if any.
    if (c.env.RATE_LIMIT_KV) {
      try { await c.env.RATE_LIMIT_KV.delete(`hold:${consultant}:${start}`); } catch {}
    }
    // Invalidate cached availability windows for this consultant.
    if (c.env.RATE_LIMIT_KV) {
      try {
        const prefix = `avail:${consultant}:`;
        const list = await c.env.RATE_LIMIT_KV.list({ prefix, limit: 100 });
        await Promise.all((list.keys || []).map(k => c.env.RATE_LIMIT_KV.delete(k.name)));
      } catch {}
    }

    return c.json({
      ok: true,
      booking: row,
      meeting_url: meetingUrl,
      provider: primary,
      warnings: (primary && !externalEventId)
        ? ['Calendar write failed — booking saved locally only.']
        : [],
    });
  });

  // Calendly webhook — syncs invitee.created / invitee.canceled into bookings.
  app.post('/api/webhooks/calendly', async (c) => {
    const sig = c.req.header('calendly-webhook-signature') || '';
    const raw = await c.req.text();
    const ok  = await verifyCalendlySignature(c.env, sig, raw);
    if (!ok) return c.json({ error: 'Bad signature' }, 401);
    let payload; try { payload = JSON.parse(raw); } catch { return c.json({ error: 'Bad JSON' }, 400); }
    const event = payload?.event || '';
    const p = payload?.payload || {};
    const userUri = p?.event?.event_memberships?.[0]?.user
                 || p?.event?.event_memberships?.[0]?.user_url
                 || null;
    if (!userUri) return c.json({ ok: true, ignored: 'no user uri' });

    const conn = await c.env.DB.prepare(
      `SELECT wallet FROM availability_providers
        WHERE provider = 'calendly' AND external_account_id = ?
        ORDER BY id DESC LIMIT 1`
    ).bind(userUri).first();
    if (!conn) return c.json({ ok: true, ignored: 'wallet not mapped' });

    const externalEventId = p?.event?.uri || null;
    const start = p?.event?.start_time || null;
    const end   = p?.event?.end_time   || null;
    const inviteeName  = p?.invitee?.name || '';
    const inviteeEmail = p?.invitee?.email || '';

    if (event === 'invitee.created' && start && end) {
      await c.env.DB.prepare(
        `INSERT INTO bookings
           (consultant_wallet, client_wallet, client_name, topic,
            booking_date, time_slot, duration, price_usdc, status,
            provider, external_event_id, meeting_url, ends_at)
         VALUES (?, '0x0000000000000000000000000000000000000000', ?, ?, ?, ?, ?, 0, 'confirmed',
                 'calendly', ?, ?, ?)`
      ).bind(
        conn.wallet, inviteeName || inviteeEmail, p?.event?.name || 'Calendly event',
        start, new Date(start).toISOString().slice(11, 16),
        Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
        externalEventId, p?.event?.location?.join_url || null, end
      ).run();
    } else if (event === 'invitee.canceled' && externalEventId) {
      await c.env.DB.prepare(
        `UPDATE bookings SET status = 'cancelled'
          WHERE provider = 'calendly' AND external_event_id = ?`
      ).bind(externalEventId).run();
    }
    return c.json({ ok: true });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny self-contained HTML for OAuth callback (closes popup or redirects).
// ────────────────────────────────────────────────────────────────────────────

function renderCallbackPage({ ok, provider, message, returnTo, allowedOrigin }) {
  const safeMsg = String(message || '').replace(/[<>&"']/g, ch => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const safeReturn = String(returnTo || '/profile/').replace(/[<>&"']/g, '');
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${ok ? 'Connected' : 'Failed'}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background:#0A0F1A; color:#ECF4FA;
         min-height:100vh; display:flex; align-items:center; justify-content:center; margin:0; }
  .card { max-width:420px; padding:32px; background:#121a26; border:1px solid #243446; border-radius:12px; text-align:center; }
  .ok { color:#22c55e; } .err { color:#ef4444; }
  h1 { margin:0 0 12px; font-size:1.4rem; }
  p { color:#a5bcd0; line-height:1.5; }
  a { color:#ff6000; text-decoration:none; font-weight:600; }
</style></head>
<body><div class="card">
  <h1 class="${ok ? 'ok' : 'err'}">${ok ? '✓ Connected' : '✗ Failed'}</h1>
  <p>${safeMsg}</p>
  ${ok ? `<p><a href="${safeReturn}">Return to your dashboard →</a></p>` : ''}
</div>
<script>
  try {
    if (window.opener) {
      // Target the configured site origin so an attacker who tricks a
      // victim into loading this callback in their popup cannot harvest
      // the message. Falls back to the document's own origin (the popup
      // and opener share an origin in the typical first-party flow).
      var TARGET_ORIGIN = ${JSON.stringify(allowedOrigin || '')} || window.location.origin;
      window.opener.postMessage({
        type: 'tkn-oauth-callback',
        ok: ${ok ? 'true' : 'false'},
        provider: ${JSON.stringify(provider || null)}
      }, TARGET_ORIGIN);
      setTimeout(function(){ window.close(); }, ${ok ? 800 : 4000});
    } else if (${ok ? 'true' : 'false'}) {
      setTimeout(function(){ location.href = ${JSON.stringify(safeReturn)}; }, 1200);
    }
  } catch (e) {}
</script>
</body></html>`;
}
