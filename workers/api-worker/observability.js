/**
 * observability.js — Phase 7
 *
 * Wires Workers Analytics Engine to log every API request for the
 * /admin/observability dashboard. AE is opt-in: if the binding is
 * missing the middleware no-ops so local dev never breaks.
 *
 * Schema (AE writeDataPoint):
 *   blobs   = [route, method, status_class, country, role]
 *   doubles = [latency_ms, status_code, bytes_out]
 *   indexes = [route]   ← AE charges per-index cardinality, route is bounded
 *
 * Admin endpoints (gated by requireRole('admin')):
 *   GET /admin/observability/summary?window=1h
 *   GET /admin/observability/routes?window=1h
 *   GET /admin/observability/errors?window=15m&limit=50
 */

import { requireRole } from './auth.js';

const KNOWN_ROUTE_PATTERNS = [
  /^(\/api\/[^/]+)/,
  /^(\/admin\/[^/]+)/,
  /^(\/stream\/[^/]+)/,
];

// Bucket the path into a low-cardinality route label for AE indexing.
function routeLabel(path) {
  for (const rx of KNOWN_ROUTE_PATTERNS) {
    const m = path.match(rx);
    if (m) return m[1];
  }
  return '/other';
}

function statusClass(code) {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return '1xx';
}

/**
 * Per-request logger. Mount EARLY (after secureHeaders, before auth) so
 * we capture the latency of denied/rate-limited responses too.
 */
export function analyticsMiddleware() {
  return async function analytics(c, next) {
    const t0 = Date.now();
    try {
      await next();
    } finally {
      const latency = Date.now() - t0;
      const ds = c.env && c.env.ANALYTICS;
      if (!ds || typeof ds.writeDataPoint !== 'function') return;
      try {
        const route = routeLabel(c.req.path);
        const status = c.res ? c.res.status : 0;
        const country = (c.req.header('cf-ipcountry') || 'XX').toUpperCase();
        // The wallet (if SIWE-authenticated) is attached to context by
        // requireAuth; we read it best-effort and never throw.
        const role = (c.get && c.get('role')) || 'anon';
        const bytes = Number(c.res && c.res.headers.get('content-length')) || 0;
        ds.writeDataPoint({
          blobs: [route, c.req.method, statusClass(status), country, role],
          doubles: [latency, status, bytes],
          indexes: [route],
        });
      } catch (_) {
        // Never let observability take down a request.
      }
    }
  };
}

// ---- query helpers ---------------------------------------------------

/**
 * AE is queried via a Cloudflare-hosted SQL API. The Worker can't talk
 * to it directly with its own creds (would need an account-level token),
 * so we accept the dataset name + an account-scoped CF_API_TOKEN secret.
 * If either is missing we return a stubbed-but-honest response so the
 * admin UI can render an "observability not configured" empty state.
 */
async function aeQuery(env, sql) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.ANALYTICS_ENGINE_DATASET) {
    return {
      ok: false,
      error: 'analytics-not-configured',
      missing: [
        !env.CF_ACCOUNT_ID && 'CF_ACCOUNT_ID',
        !env.CF_API_TOKEN && 'CF_API_TOKEN',
        !env.ANALYTICS_ENGINE_DATASET && 'ANALYTICS_ENGINE_DATASET',
      ].filter(Boolean),
    };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    });
    if (!r.ok) {
      return { ok: false, error: `ae-${r.status}`, body: await r.text() };
    }
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: 'ae-fetch-failed', message: e.message };
  }
}

function windowToInterval(w) {
  const m = String(w || '1h').match(/^(\d+)\s*(m|h|d)$/);
  if (!m) return "INTERVAL '1' HOUR";
  const n = Math.max(1, Math.min(parseInt(m[1], 10), 720));
  const unit = { m: 'MINUTE', h: 'HOUR', d: 'DAY' }[m[2]];
  return `INTERVAL '${n}' ${unit}`;
}

export function mountObservabilityRoutes(app) {
  app.get('/admin/observability/summary', requireRole('admin'), async (c) => {
    const ds = c.env.ANALYTICS_ENGINE_DATASET;
    if (!ds) {
      return c.json({ ok: false, error: 'analytics-not-configured' }, 503);
    }
    const interval = windowToInterval(c.req.query('window'));
    // Workers Analytics Engine SQL is ClickHouse-compatible but only
    // exposes a subset of aggregate functions. quantileWeighted is the
    // documented way to compute percentiles when rows carry a sample
    // interval (which AE rows always do).
    const sql = `
      SELECT
        SUM(_sample_interval)                                  AS requests,
        AVG(double2)                                           AS avg_status,
        AVG(double1)                                           AS avg_latency_ms,
        quantileWeighted(0.95)(double1, _sample_interval)      AS p95_latency_ms,
        SUM(IF(double2 >= 500, _sample_interval, 0))           AS errors_5xx,
        SUM(IF(double2 >= 400 AND double2 < 500, _sample_interval, 0)) AS errors_4xx
      FROM ${ds}
      WHERE timestamp >= NOW() - ${interval}
    `;
    const r = await aeQuery(c.env, sql);
    if (!r.ok) return c.json(r, 503);
    return c.json({ ok: true, window: c.req.query('window') || '1h', ...r.data });
  });

  app.get('/admin/observability/routes', requireRole('admin'), async (c) => {
    const ds = c.env.ANALYTICS_ENGINE_DATASET;
    if (!ds) return c.json({ ok: false, error: 'analytics-not-configured' }, 503);
    const interval = windowToInterval(c.req.query('window'));
    const sql = `
      SELECT
        index1                                                 AS route,
        SUM(_sample_interval)                                  AS requests,
        AVG(double1)                                           AS avg_latency_ms,
        quantileWeighted(0.95)(double1, _sample_interval)      AS p95_latency_ms,
        SUM(IF(double2 >= 500, _sample_interval, 0))           AS errors_5xx
      FROM ${ds}
      WHERE timestamp >= NOW() - ${interval}
      GROUP BY route
      ORDER BY requests DESC
      LIMIT 50
    `;
    const r = await aeQuery(c.env, sql);
    if (!r.ok) return c.json(r, 503);
    return c.json({ ok: true, window: c.req.query('window') || '1h', ...r.data });
  });

  app.get('/admin/observability/errors', requireRole('admin'), async (c) => {
    const ds = c.env.ANALYTICS_ENGINE_DATASET;
    if (!ds) return c.json({ ok: false, error: 'analytics-not-configured' }, 503);
    const interval = windowToInterval(c.req.query('window') || '15m');
    const sql = `
      SELECT
        index1               AS route,
        blob1                AS route_blob,
        blob2                AS method,
        blob3                AS status_class,
        blob4                AS country,
        double2              AS status,
        double1              AS latency_ms,
        timestamp
      FROM ${c.env.ANALYTICS_ENGINE_DATASET}
      WHERE timestamp >= NOW() - ${interval}
        AND double2 >= 400
      ORDER BY timestamp DESC
      LIMIT 100
    `;
    const r = await aeQuery(c.env, sql);
    if (!r.ok) return c.json(r, 503);
    return c.json({ ok: true, window: c.req.query('window') || '15m', ...r.data });
  });
}
