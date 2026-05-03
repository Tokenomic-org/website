/**
 * Phase 3b — Consultant workbench JSON API.
 *
 * All routes gated by `requireRole(['consultant', 'admin'])`. The consultant
 * wallet is sourced from the session; never trusted from the request body.
 *
 * Endpoints (mounted at /api/consultant/*):
 *   GET    /me/services
 *   POST   /services
 *   PATCH  /services/:id
 *   DELETE /services/:id
 *   GET    /me/availability                  Phase-4 stub: weekly recurring slots.
 *   POST   /me/availability                  Replace the caller's full availability set.
 *   GET    /me/bookings                      Bookings as the consultant, with escrow status.
 *   POST   /bookings/:id/escrow              Record an on-chain escrow status transition.
 */

import { requireRole } from './auth.js';

function lc(s) { return (s || '').toString().toLowerCase(); }
function isHex64(s) { return /^0x[0-9a-fA-F]{64}$/.test(s || ''); }

function dbReady(c) {
  if (!c.env.DB) return c.json({ error: 'Database not configured' }, 503);
  return null;
}

const ESCROW_STATES = new Set(['none', 'held', 'released', 'disputed', 'refunded']);

export function mountConsultantRoutes(app) {
  const gate = requireRole(['consultant', 'admin']);

  // --- services ---

  app.get('/api/consultant/me/services', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM services WHERE consultant_wallet = ? ORDER BY created_at DESC LIMIT 200'
    ).bind(wallet).all();
    return c.json({ items: results || [] });
  });

  app.post('/api/consultant/services', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const title = (body.title || '').toString().trim();
    if (title.length < 2 || title.length > 200) return c.json({ error: 'Title 2-200 chars' }, 400);
    const dur = Number(body.duration_min || 30);
    const price = Number(body.price_usdc || 0);
    if (!Number.isFinite(dur) || dur < 5 || dur > 1440) return c.json({ error: 'duration_min 5-1440' }, 400);
    if (!Number.isFinite(price) || price < 0 || price > 1e7) return c.json({ error: 'price_usdc 0-1e7' }, 400);
    const desc = (body.description || '').toString().slice(0, 4000);
    const cat  = body.category ? String(body.category).slice(0, 80) : null;
    const status = body.status === 'draft' || body.status === 'archived' ? body.status : 'active';
    const res = await c.env.DB.prepare(`
      INSERT INTO services (consultant_wallet, title, description, duration_min, price_usdc, category, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(wallet, title, desc, Math.round(dur), price, cat, status).run();
    const id = res.meta && res.meta.last_row_id;
    const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(id).first();
    return c.json({ ok: true, service: row });
  });

  app.patch('/api/consultant/services/:id', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (lc(row.consultant_wallet) !== wallet && !c.get('isAdmin')) {
      return c.json({ error: 'Not your service' }, 403);
    }
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const sets = [], binds = [];
    if (typeof body.title === 'string')       { sets.push('title = ?'); binds.push(body.title.slice(0, 200)); }
    if (typeof body.description === 'string') { sets.push('description = ?'); binds.push(body.description.slice(0, 4000)); }
    if (typeof body.category === 'string')    { sets.push('category = ?'); binds.push(body.category.slice(0, 80)); }
    if (body.duration_min !== undefined) {
      const n = Number(body.duration_min);
      if (!Number.isFinite(n) || n < 5 || n > 1440) return c.json({ error: 'duration_min 5-1440' }, 400);
      sets.push('duration_min = ?'); binds.push(Math.round(n));
    }
    if (body.price_usdc !== undefined) {
      const n = Number(body.price_usdc);
      if (!Number.isFinite(n) || n < 0 || n > 1e7) return c.json({ error: 'price_usdc 0-1e7' }, 400);
      sets.push('price_usdc = ?'); binds.push(n);
    }
    if (body.status === 'active' || body.status === 'draft' || body.status === 'archived') {
      sets.push('status = ?'); binds.push(body.status);
    }
    if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
    sets.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return c.json({ ok: true });
  });

  app.delete('/api/consultant/services/:id', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    const row = await c.env.DB.prepare('SELECT consultant_wallet FROM services WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (lc(row.consultant_wallet) !== wallet && !c.get('isAdmin')) {
      return c.json({ error: 'Not your service' }, 403);
    }
    await c.env.DB.prepare('DELETE FROM services WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });

  // --- availability (Phase-4 stub: weekly recurring slots) ---

  app.get('/api/consultant/me/availability', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(
      'SELECT id, weekday, start_min, end_min, timezone FROM availability_slots WHERE consultant_wallet = ? ORDER BY weekday, start_min'
    ).bind(wallet).all();
    return c.json({ items: results || [] });
  });

  app.post('/api/consultant/me/availability', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const slots = Array.isArray(body.slots) ? body.slots.slice(0, 100) : [];
    const tz = (body.timezone || 'UTC').toString().slice(0, 64);
    const valid = slots.filter((s) =>
      Number.isInteger(s?.weekday) && s.weekday >= 0 && s.weekday <= 6 &&
      Number.isInteger(s?.start_min) && s.start_min >= 0 && s.start_min < 1440 &&
      Number.isInteger(s?.end_min) && s.end_min > s.start_min && s.end_min <= 1440
    );
    await c.env.DB.prepare('DELETE FROM availability_slots WHERE consultant_wallet = ?').bind(wallet).run();
    if (valid.length) {
      const stmt = c.env.DB.prepare(`
        INSERT INTO availability_slots (consultant_wallet, weekday, start_min, end_min, timezone)
        VALUES (?, ?, ?, ?, ?)
      `);
      await c.env.DB.batch(valid.map((s) => stmt.bind(wallet, s.weekday, s.start_min, s.end_min, tz)));
    }
    return c.json({ ok: true, count: valid.length });
  });

  // --- bookings (consultant view, includes escrow status) ---

  app.get('/api/consultant/me/bookings', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const status = c.req.query('escrow_status');
    const where = ['consultant_wallet = ?'];
    const binds = [wallet];
    if (status && ESCROW_STATES.has(status)) { where.push('escrow_status = ?'); binds.push(status); }
    const { results } = await c.env.DB.prepare(`
      SELECT b.*, s.title AS service_title, p.display_name AS client_display_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN profiles p ON lower(p.wallet_address) = lower(b.client_wallet)
      WHERE ${where.join(' AND ')}
      ORDER BY b.created_at DESC LIMIT 200
    `).bind(...binds).all();
    return c.json({ items: results || [] });
  });

  app.post('/api/consultant/bookings/:id/escrow', gate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Bad id' }, 400);
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const next = String(body.escrow_status || '').toLowerCase();
    if (!ESCROW_STATES.has(next)) return c.json({ error: 'Invalid escrow_status' }, 400);
    const tx = (body.tx_hash || '').toString();
    if (tx && !isHex64(tx)) return c.json({ error: 'Bad tx_hash' }, 400);
    const b = await c.env.DB.prepare('SELECT consultant_wallet FROM bookings WHERE id = ?').bind(id).first();
    if (!b) return c.json({ error: 'Not found' }, 404);
    if (lc(b.consultant_wallet) !== wallet && !c.get('isAdmin')) {
      return c.json({ error: 'Not your booking' }, 403);
    }
    await c.env.DB.prepare(
      'UPDATE bookings SET escrow_status = ?, escrow_tx = COALESCE(?, escrow_tx) WHERE id = ?'
    ).bind(next, tx || null, id).run();
    return c.json({ ok: true });
  });
}
