/**
 * api-worker
 * Hono app exposing:
 *   GET  /api/comments/:articleSlug              List approved comments
 *   POST /api/comments/:articleSlug              Submit a comment (rate limited)
 *   GET  /api/dashboard/stats                    Aggregate stats from KV
 *   GET  /api/dashboard/activity                 Recent activity feed
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

app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal error', message: err.message }, 500);
});

export default app;
