/**
 * api-worker
 * Hono app exposing:
 *   GET  /api/comments/:articleSlug              List approved comments
 *   POST /api/comments/:articleSlug              Submit a comment (rate limited)
 *   GET  /api/dashboard/stats                    Aggregate stats from KV
 *   GET  /api/dashboard/activity                 Recent activity feed
 *   POST /stream/direct-upload                   Cloudflare Stream creator upload URL
 *   GET  /stream/:uid                            Stream asset status + playback URLs
 *   POST /stream/:uid/json-meta                  Persist course metadata for a Stream uid
 *   GET  /api/health
 *
 * Bindings (wrangler.toml):
 *   - COMMENTS_KV    KV namespace
 *   - RATE_LIMIT_KV  KV namespace (optional, falls back to in-memory)
 *
 * Env vars:
 *   - ALLOWED_ORIGINS  comma-separated list (default: tokenomic.org + cf-ipfs.com)
 *   - MAX_COMMENT_LEN  default 4000
 *   - REQUIRE_WALLET   "true" to require a wallet address on POST (default false)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { mountD1Routes } from './d1-routes.js';
import { ChatRoom, mountChatRoutes } from './chat-room.js';
import { mountSiweRoutes } from './siwe.js';

export { ChatRoom };

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());

app.use('*', async (c, next) => {
  const allowList = (c.env.ALLOWED_ORIGINS || 'https://tokenomic.org,https://*.tokenomic.org,https://*.cf-ipfs.com,https://*.pages.dev,http://localhost:5000')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const handler = cors({
    origin: (origin) => {
      if (!origin) return '*';
      for (const pattern of allowList) {
        if (pattern === origin) return origin;
        if (pattern.startsWith('https://*.')) {
          const suffix = pattern.slice('https://*.'.length);
          if (origin.startsWith('https://') && origin.endsWith('.' + suffix)) return origin;
        }
      }
      return null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Wallet'],
    maxAge: 86400
  });
  return handler(c, next);
});

const memoryBuckets = new Map();
async function rateLimit(c, key, limit = 10, windowSec = 60) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const bucketKey = `rl:${key}`;

  if (c.env.RATE_LIMIT_KV) {
    try {
      const raw = await c.env.RATE_LIMIT_KV.get(bucketKey);
      let bucket = raw ? JSON.parse(raw) : { count: 0, reset: now + windowMs };
      if (now > bucket.reset) bucket = { count: 0, reset: now + windowMs };
      bucket.count += 1;
      const remaining = Math.max(0, limit - bucket.count);
      c.executionCtx.waitUntil(
        c.env.RATE_LIMIT_KV.put(bucketKey, JSON.stringify(bucket), { expirationTtl: windowSec + 5 })
      );
      return { ok: bucket.count <= limit, limit, remaining, reset: bucket.reset };
    } catch (e) {
      console.warn('KV rate limit failed, falling back to memory:', e.message);
    }
  }

  let bucket = memoryBuckets.get(bucketKey);
  if (!bucket || now > bucket.reset) bucket = { count: 0, reset: now + windowMs };
  bucket.count += 1;
  memoryBuckets.set(bucketKey, bucket);
  return { ok: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), reset: bucket.reset };
}

function clientIp(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'anon';
}

function escapeForStorage(s, maxLen) {
  if (typeof s !== 'string') return '';
  return s.replace(/\u0000/g, '').slice(0, maxLen);
}

function isValidSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-_]{0,128}$/i.test(s);
}

function isHexAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

app.get('/api/health', (c) => c.json({ ok: true, worker: 'api-worker', ts: Date.now() }));

// SIWE cookie-session auth (Phase 0): GET /api/siwe/nonce, POST /api/siwe/verify,
// POST /api/siwe/logout, GET /api/siwe/me. Sets HMAC-signed HTTP-only
// `tk_session` cookie used by `requireAuth()` middleware.
mountSiweRoutes(app);

// D1-backed routes (profiles, courses, communities, articles, experts, revenue, bookings, enrollments, messages, auth)
mountD1Routes(app);

// Real-time chat over WebSocket Durable Objects
mountChatRoutes(app);

app.get('/api/comments/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!isValidSlug(slug)) return c.json({ error: 'Invalid article slug' }, 400);
  if (!c.env.COMMENTS_KV) return c.json({ error: 'Comments storage not configured' }, 503);

  try {
    const list = await c.env.COMMENTS_KV.list({ prefix: `comment:${slug}:` });
    const items = await Promise.all(
      list.keys.map(async (k) => {
        const raw = await c.env.COMMENTS_KV.get(k.name);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      })
    );
    const comments = items
      .filter((x) => x && x.status === 'approved')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return c.json({ slug, count: comments.length, comments });
  } catch (e) {
    console.error('comments list failed:', e);
    return c.json({ error: 'Failed to load comments' }, 500);
  }
});

app.post('/api/comments/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!isValidSlug(slug)) return c.json({ error: 'Invalid article slug' }, 400);
  if (!c.env.COMMENTS_KV) return c.json({ error: 'Comments storage not configured' }, 503);

  const ip = clientIp(c);
  const rl = await rateLimit(c, `${ip}:comment`, 10, 60);
  c.header('X-RateLimit-Limit', String(rl.limit));
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return c.json({ error: 'Rate limit exceeded. Try again in a minute.' }, 429);

  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const maxLen = parseInt(c.env.MAX_COMMENT_LEN || '4000', 10);
  const text = escapeForStorage(body && body.text, maxLen);
  const author = escapeForStorage(body && body.author, 80) || 'Anonymous';
  const wallet = body && body.wallet;

  if (!text || text.length < 2) return c.json({ error: 'Comment text required (min 2 chars)' }, 400);
  if ((c.env.REQUIRE_WALLET === 'true') && !isHexAddress(wallet)) {
    return c.json({ error: 'A valid wallet address is required to post' }, 400);
  }
  if (wallet && !isHexAddress(wallet)) return c.json({ error: 'Invalid wallet address' }, 400);

  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const comment = {
    id,
    slug,
    text,
    author,
    wallet: wallet || null,
    ip: ip.slice(0, 64),
    status: 'approved',
    createdAt: Date.now()
  };

  try {
    await c.env.COMMENTS_KV.put(`comment:${slug}:${id}`, JSON.stringify(comment), {
      expirationTtl: 60 * 60 * 24 * 365
    });
    c.executionCtx.waitUntil(bumpCounter(c.env.COMMENTS_KV, `count:${slug}`));
    return c.json({ ok: true, comment });
  } catch (e) {
    console.error('comment write failed:', e);
    return c.json({ error: 'Failed to save comment' }, 500);
  }
});

async function bumpCounter(kv, key) {
  try {
    const cur = parseInt((await kv.get(key)) || '0', 10);
    await kv.put(key, String(cur + 1));
  } catch (e) { /* non-fatal */ }
}

app.get('/api/dashboard/stats', async (c) => {
  if (!c.env.COMMENTS_KV) return c.json({ error: 'Storage not configured' }, 503);
  try {
    const counts = await c.env.COMMENTS_KV.list({ prefix: 'count:' });
    let totalComments = 0;
    const perArticle = {};
    await Promise.all(counts.keys.map(async (k) => {
      const v = parseInt((await c.env.COMMENTS_KV.get(k.name)) || '0', 10);
      totalComments += v;
      perArticle[k.name.slice('count:'.length)] = v;
    }));
    return c.json({
      ok: true,
      totals: { comments: totalComments, articles: counts.keys.length },
      perArticle,
      ts: Date.now()
    });
  } catch (e) {
    console.error('stats failed:', e);
    return c.json({ error: 'Failed to compute stats' }, 500);
  }
});

app.get('/api/dashboard/activity', async (c) => {
  if (!c.env.COMMENTS_KV) return c.json({ error: 'Storage not configured' }, 503);
  const limit = Math.min(50, parseInt(c.req.query('limit') || '20', 10));
  try {
    const list = await c.env.COMMENTS_KV.list({ prefix: 'comment:', limit: 200 });
    const items = await Promise.all(list.keys.map(async (k) => {
      const raw = await c.env.COMMENTS_KV.get(k.name);
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    }));
    const recent = items
      .filter((x) => x && x.status === 'approved')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, limit)
      .map((c) => ({
        type: 'comment',
        slug: c.slug,
        author: c.author,
        wallet: c.wallet,
        excerpt: (c.text || '').slice(0, 140),
        createdAt: c.createdAt
      }));
    return c.json({ ok: true, items: recent, count: recent.length });
  } catch (e) {
    console.error('activity failed:', e);
    return c.json({ error: 'Failed to load activity' }, 500);
  }
});

/**
 * Cloudflare Stream — Direct Creator Upload
 *
 * Course videos are hosted on Cloudflare Stream (managed encoding,
 * adaptive HLS/DASH, embed players, signed URLs). The browser never
 * sees the account-wide CF_STREAM_TOKEN — it's held server-side here.
 *
 *   POST /stream/direct-upload     body: { name?, maxDurationSeconds?, creator?, meta? }
 *                                  -> { uid, uploadURL, playback, embed, thumbnail }
 *   GET  /stream/:uid              -> { uid, status, duration, playback, embed, thumbnail, ready }
 *   POST /stream/:uid/json-meta    body: { ...metadata }   stored alongside in COMMENTS_KV
 *                                  -> { ok: true, key }
 *
 * Required env:
 *   CF_ACCOUNT_ID    Cloudflare account id
 *   CF_STREAM_TOKEN  API token with `Stream:Edit` permission (secret)
 */
function streamCustomerSubdomain(env, uid, kind = 'hls') {
  const sub = env.STREAM_CUSTOMER_SUBDOMAIN || ''; // e.g. customer-abc123.cloudflarestream.com
  if (!sub || !uid) return '';
  if (kind === 'embed') return `https://${sub}/${uid}/iframe`;
  if (kind === 'thumb') return `https://${sub}/${uid}/thumbnails/thumbnail.jpg`;
  if (kind === 'dash')  return `https://${sub}/${uid}/manifest/video.mpd`;
  return `https://${sub}/${uid}/manifest/video.m3u8`;
}

function streamPlaybackBlock(env, uid, apiPlayback) {
  // CF API returns playback.{hls,dash} once the upload is ready; before that
  // we synthesize URLs from STREAM_CUSTOMER_SUBDOMAIN if configured.
  const hls  = (apiPlayback && apiPlayback.hls)  || streamCustomerSubdomain(env, uid, 'hls');
  const dash = (apiPlayback && apiPlayback.dash) || streamCustomerSubdomain(env, uid, 'dash');
  return {
    uid,
    playback:  { hls, dash },
    embed:     streamCustomerSubdomain(env, uid, 'embed'),
    thumbnail: streamCustomerSubdomain(env, uid, 'thumb')
  };
}

async function callStream(env, path, init = {}) {
  if (!env.CF_STREAM_TOKEN || !env.CF_ACCOUNT_ID) {
    return { ok: false, status: 503, error: 'Cloudflare Stream not configured' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CF_STREAM_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data || data.success === false) {
    const msg = (data && data.errors && data.errors[0] && data.errors[0].message) || `Stream API ${resp.status}`;
    return { ok: false, status: resp.status || 502, error: msg };
  }
  return { ok: true, data };
}

app.post('/stream/direct-upload', async (c) => {
  const ip = clientIp(c);
  const rl = await rateLimit(c, `${ip}:stream-upload`, 20, 60);
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return c.json({ error: 'Rate limit exceeded' }, 429);

  let body = {};
  try { body = await c.req.json(); } catch {}
  const wallet = (c.req.header('x-wallet') || body.creator || '').toString().slice(0, 64);
  const maxDuration = Math.min(
    parseInt(body.maxDurationSeconds || c.env.STREAM_MAX_DURATION_SECONDS || '21600', 10),
    21600
  );
  const meta = Object.assign(
    {
      name: (body.name || 'tokenomic-course').toString().slice(0, 200),
      uploadedFrom: 'tokenomic-api'
    },
    typeof body.meta === 'object' && body.meta ? body.meta : {}
  );
  const allowedOrigins = (c.env.STREAM_ALLOWED_ORIGINS || c.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((s) => s && !s.includes('*'));

  const r = await callStream(c.env, '/direct_upload', {
    method: 'POST',
    body: JSON.stringify({
      maxDurationSeconds: maxDuration,
      creator: wallet || undefined,
      meta,
      requireSignedURLs: false,
      allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined
    })
  });
  if (!r.ok) return c.json({ error: r.error }, r.status);

  const uid = r.data.result.uid;
  const uploadURL = r.data.result.uploadURL;
  return c.json({
    ok: true,
    uploadURL,
    ...streamPlaybackBlock(c.env, uid, null)
  });
});

app.get('/stream/:uid', async (c) => {
  const uid = c.req.param('uid');
  if (!/^[a-f0-9]{20,64}$/i.test(uid)) return c.json({ error: 'Invalid uid' }, 400);
  const r = await callStream(c.env, `/${uid}`);
  if (!r.ok) return c.json({ error: r.error }, r.status);
  const v = r.data.result;
  return c.json({
    ok: true,
    status: v.status && v.status.state,
    ready: v.readyToStream === true,
    duration: v.duration || 0,
    size: v.size || 0,
    meta: v.meta || {},
    ...streamPlaybackBlock(c.env, v.uid, v.playback)
  });
});

app.post('/stream/:uid/json-meta', async (c) => {
  const ip = clientIp(c);
  const rl = await rateLimit(c, `${ip}:stream-meta`, 60, 60);
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return c.json({ error: 'Rate limit exceeded' }, 429);

  const uid = c.req.param('uid');
  if (!/^[a-f0-9]{20,64}$/i.test(uid)) return c.json({ error: 'Invalid uid' }, 400);
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object') return c.json({ error: 'Body must be a JSON object' }, 400);
  if (!c.env.COMMENTS_KV) return c.json({ error: 'Storage not configured' }, 503);

  const key = `stream-meta:${uid}`;
  await c.env.COMMENTS_KV.put(key, JSON.stringify(body));
  return c.json({ ok: true, key, uri: `stream:${uid}` });
});

app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal error', message: err.message }, 500);
});

export default app;
