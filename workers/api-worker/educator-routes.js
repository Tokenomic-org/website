/**
 * Phase 3b — Educator workbench JSON API.
 *
 * All routes are gated by `requireRole('educator')` (admin also passes via
 * the role union). The educator's wallet is taken from the SIWE/JWT session;
 * no wallet param is accepted for write operations.
 *
 * Endpoints (mounted at /api/educator/*):
 *   GET  /me/courses                          List courses owned by caller (any status).
 *   GET  /courses/:id/students                Roster + per-student progress.
 *   GET  /courses/:id/analytics               Enrollments / completion / revenue per day.
 *   GET  /me/articles                         Articles authored by caller.
 *   POST /articles                            Create or upsert an article (paywall, scheduled).
 *   PATCH /articles/:id                       Update article (markdown, paywall, schedule).
 *   GET  /me/revenue/splits                   Claimable RevenueSplitter shares (D1-backed stub).
 *   POST /certificates/batch                  Record a mintBatch tx hash (one row per recipient).
 *   GET  /me/certificates/recent              Last 50 mint records by caller.
 */

import { requireRole } from './auth.js';

function lc(s) { return (s || '').toString().toLowerCase(); }
function jsonOrNull(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }
function isHex40(s)  { return /^0x[0-9a-fA-F]{40}$/.test(s || ''); }
function isHex64(s)  { return /^0x[0-9a-fA-F]{64}$/.test(s || ''); }

function dbReady(c) {
  if (!c.env.DB) return c.json({ error: 'Database not configured' }, 503);
  return null;
}

export function mountEducatorRoutes(app) {
  const gate = requireRole(['educator', 'admin']);

  app.get('/api/educator/me/courses', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM courses WHERE educator_wallet = ? ORDER BY created_at DESC LIMIT 200'
    ).bind(wallet).all();
    const items = (results || []).map((row) => ({
      ...row,
      what_you_learn: jsonOrNull(row.what_you_learn) || [],
    }));
    return c.json({ items, count: items.length });
  });

  app.get('/api/educator/courses/:id/students', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    const course = await c.env.DB.prepare(
      'SELECT id, title, educator_wallet, modules_count FROM courses WHERE id = ?'
    ).bind(id).first();
    if (!course) return c.json({ error: 'Course not found' }, 404);
    if (lc(course.educator_wallet) !== wallet && !c.get('isAdmin')) {
      return c.json({ error: 'Not your course' }, 403);
    }
    const { results } = await c.env.DB.prepare(`
      SELECT e.id, e.student_wallet, e.progress, e.enrolled_at, e.completed_at, e.last_seen_at,
             p.display_name AS student_name, p.avatar_url
      FROM enrollments e
      LEFT JOIN profiles p ON lower(p.wallet_address) = lower(e.student_wallet)
      WHERE e.course_id = ?
      ORDER BY e.enrolled_at DESC
      LIMIT 500
    `).bind(id).all();
    const items = results || [];
    const total = items.length;
    const completed = items.filter((s) => (s.progress || 0) >= 100).length;
    return c.json({
      course: { id: course.id, title: course.title, modules_count: course.modules_count || 0 },
      items, total, completed,
      avg_progress: total ? Math.round(items.reduce((s, x) => s + (x.progress || 0), 0) / total) : 0,
    });
  });

  app.get('/api/educator/courses/:id/analytics', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    const course = await c.env.DB.prepare(
      'SELECT id, educator_wallet, price_usdc FROM courses WHERE id = ?'
    ).bind(id).first();
    if (!course) return c.json({ error: 'Course not found' }, 404);
    if (lc(course.educator_wallet) !== wallet && !c.get('isAdmin')) {
      return c.json({ error: 'Not your course' }, 403);
    }
    const { results: enrollSeries } = await c.env.DB.prepare(`
      SELECT substr(enrolled_at, 1, 10) AS day, COUNT(*) AS n
      FROM enrollments WHERE course_id = ?
      GROUP BY day ORDER BY day ASC LIMIT 90
    `).bind(id).all();
    const { results: completionSeries } = await c.env.DB.prepare(`
      SELECT substr(completed_at, 1, 10) AS day, COUNT(*) AS n
      FROM enrollments WHERE course_id = ? AND completed_at IS NOT NULL
      GROUP BY day ORDER BY day ASC LIMIT 90
    `).bind(id).all();
    const price = Number(course.price_usdc || 0);
    const revenueSeries = (enrollSeries || []).map((row) => ({
      day: row.day, usdc: Math.round(row.n * price * 100) / 100,
    }));
    return c.json({
      course_id: id,
      enrollments: enrollSeries || [],
      completions: completionSeries || [],
      revenue:    revenueSeries,
    });
  });

  app.get('/api/educator/me/articles', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(`
      SELECT id, slug, title, excerpt, status, paywalled, scheduled_publish_at,
             published_at, created_at, image_url, reading_time
      FROM articles WHERE author_wallet = ? ORDER BY created_at DESC LIMIT 200
    `).bind(wallet).all();
    return c.json({ items: results || [] });
  });

  app.post('/api/educator/articles', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const slug = (body.slug || '').toString().toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-_]{0,128}$/.test(slug)) return c.json({ error: 'Invalid slug' }, 400);
    const title = (body.title || '').toString().trim();
    if (title.length < 3 || title.length > 200) return c.json({ error: 'Title 3-200 chars' }, 400);
    const excerpt = (body.excerpt || '').toString().slice(0, 500);
    const bodyMd  = (body.body || '').toString().slice(0, 200000);
    const category = body.category ? String(body.category).slice(0, 80) : null;
    const paywalled = body.paywalled ? 1 : 0;
    const scheduled = body.scheduled_publish_at ? String(body.scheduled_publish_at).slice(0, 40) : null;
    const status = scheduled ? 'scheduled' : (body.status || 'draft');
    try {
      const res = await c.env.DB.prepare(`
        INSERT INTO articles
          (slug, title, excerpt, body, category, author_wallet, status, paywalled,
           scheduled_publish_at, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        slug, title, excerpt, bodyMd, category, wallet, status, paywalled,
        scheduled, status === 'published' ? new Date().toISOString() : null,
      ).run();
      const id = res.meta && res.meta.last_row_id;
      return c.json({ ok: true, id });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return c.json({ error: 'Slug already taken' }, 409);
      throw e;
    }
  });

  app.patch('/api/educator/articles/:id', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (lc(row.author_wallet) !== wallet && !c.get('isAdmin')) {
      return c.json({ error: 'Not your article' }, 403);
    }
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const sets = [], binds = [];
    if (typeof body.title === 'string')   { sets.push('title = ?');   binds.push(body.title.slice(0, 200)); }
    if (typeof body.excerpt === 'string') { sets.push('excerpt = ?'); binds.push(body.excerpt.slice(0, 500)); }
    if (typeof body.body === 'string')    { sets.push('body = ?');    binds.push(body.body.slice(0, 200000)); }
    if (typeof body.category === 'string'){ sets.push('category = ?'); binds.push(body.category.slice(0, 80)); }
    if (body.paywalled !== undefined)     { sets.push('paywalled = ?'); binds.push(body.paywalled ? 1 : 0); }
    if (body.scheduled_publish_at !== undefined) {
      sets.push('scheduled_publish_at = ?'); binds.push(body.scheduled_publish_at || null);
    }
    if (body.status === 'draft' || body.status === 'published' || body.status === 'scheduled') {
      sets.push('status = ?'); binds.push(body.status);
      if (body.status === 'published') {
        sets.push('published_at = ?'); binds.push(new Date().toISOString());
      }
    }
    if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return c.json({ ok: true });
  });

  app.get('/api/educator/me/revenue/splits', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    // D1-backed view: each `revenue_tx` row destined to the educator wallet.
    const { results } = await c.env.DB.prepare(`
      SELECT id, tx_hash, amount_usdc, sender_wallet, description, status, created_at
      FROM revenue_tx
      WHERE lower(recipient_wallet) = ?
      ORDER BY created_at DESC LIMIT 100
    `).bind(wallet).all();
    const items = results || [];
    const claimable = items
      .filter((x) => x.status === 'pending')
      .reduce((s, x) => s + Number(x.amount_usdc || 0), 0);
    const lifetime = items.reduce((s, x) => s + Number(x.amount_usdc || 0), 0);
    return c.json({ wallet, items, claimable_usdc: claimable, lifetime_usdc: lifetime });
  });

  app.post('/api/educator/certificates/batch', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const courseId = Number(body.course_id);
    const txHash   = (body.tx_hash || '').toString();
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (!Number.isFinite(courseId) || courseId <= 0) return c.json({ error: 'Bad course_id' }, 400);
    if (txHash && !isHex64(txHash)) return c.json({ error: 'Bad tx_hash' }, 400);
    if (!recipients.length || recipients.length > 200) return c.json({ error: '1-200 recipients required' }, 400);
    const course = await c.env.DB.prepare(
      'SELECT id, educator_wallet FROM courses WHERE id = ?'
    ).bind(courseId).first();
    if (!course) return c.json({ error: 'Course not found' }, 404);
    if (lc(course.educator_wallet) !== wallet && !c.get('isAdmin')) {
      return c.json({ error: 'Not your course' }, 403);
    }
    const valid = recipients.map((x) => lc(x)).filter(isHex40);
    if (!valid.length) return c.json({ error: 'No valid recipient addresses' }, 400);
    const stmt = c.env.DB.prepare(`
      INSERT INTO certificate_mints (educator_wallet, course_id, recipient_wallet, tx_hash, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    await c.env.DB.batch(
      valid.map((rw) => stmt.bind(wallet, courseId, rw, txHash || null, txHash ? 'submitted' : 'queued'))
    );
    return c.json({ ok: true, count: valid.length, tx_hash: txHash || null });
  });

  app.get('/api/educator/me/certificates/recent', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(`
      SELECT id, course_id, recipient_wallet, tx_hash, status, token_id, created_at
      FROM certificate_mints WHERE educator_wallet = ?
      ORDER BY created_at DESC LIMIT 50
    `).bind(wallet).all();
    return c.json({ items: results || [] });
  });
}
