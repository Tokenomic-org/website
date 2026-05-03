/**
 * Phase 3c — Learner home JSON API.
 *
 * Every signed-in wallet (regardless of role) lands here. The legacy
 * `/dashboard` Alpine page is replaced by a React island (LearnerShell)
 * which hydrates these `/api/me/*` endpoints. All routes are gated by
 * `requireRole('learner')`; since `resolveSession()` always adds 'learner'
 * to the role union for any valid SIWE/JWT session, this is effectively
 * `requireAuth()` while still funneling through the unified gate.
 *
 * Endpoints (mounted at /api/me/*):
 *   GET  /api/me/courses          enrollments with course join + cert flag
 *   GET  /api/me/subscriptions    active + past subscriptions
 *   GET  /api/me/communities      community_members rows + community summary
 *   GET  /api/me/bookings         bookings where client_wallet = caller
 *   GET  /api/me/referrals        referral attribution + USDC earned
 *   GET  /api/me/wallet           recent revenue_tx + cert mints
 *   GET  /api/me/certificates     issued certificates with on-chain link
 *   PATCH /api/me/profile         update display_name, email, prefs
 */

import { requireRole } from './auth.js';

function lc(s) { return (s || '').toString().toLowerCase(); }
function jsonOrNull(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

function dbReady(c) {
  if (!c.env.DB) return c.json({ error: 'Database not configured' }, 503);
  return null;
}

// Any valid session has 'learner' in its role union (see auth.js
// resolveSession). This keeps the gate uniform across the codebase.
const learnerGate = requireRole(['learner', 'educator', 'consultant', 'admin']);

export function mountLearnerRoutes(app) {
  app.get('/api/me/courses', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(`
      SELECT e.id              AS enrollment_id,
             e.course_id, e.progress, e.enrolled_at, e.completed_at, e.last_seen_at,
             co.slug, co.title, co.description, co.thumbnail_url, co.modules_count,
             co.educator_wallet, co.educator_name, co.estimated_hours,
             co.on_chain_course_id,
             ci.token_id      AS cert_token_id,
             ci.tx_hash       AS cert_tx_hash,
             ci.r2_key        AS cert_pdf_key
      FROM enrollments e
      LEFT JOIN courses co
        ON co.id = e.course_id
      LEFT JOIN certificates_issued ci
        ON ci.course_id = e.course_id AND lower(ci.student_wallet) = lower(e.student_wallet)
      WHERE lower(e.student_wallet) = ?
      ORDER BY COALESCE(e.last_seen_at, e.enrolled_at) DESC
      LIMIT 200
    `).bind(wallet).all().catch(async () => {
      // certificates_issued may not exist on legacy DBs — fall back without it.
      const fallback = await c.env.DB.prepare(`
        SELECT e.id AS enrollment_id, e.course_id, e.progress, e.enrolled_at,
               e.completed_at, e.last_seen_at,
               co.slug, co.title, co.description, co.thumbnail_url, co.modules_count,
               co.educator_wallet, co.educator_name, co.estimated_hours,
               co.on_chain_course_id
        FROM enrollments e
        LEFT JOIN courses co ON co.id = e.course_id
        WHERE lower(e.student_wallet) = ?
        ORDER BY COALESCE(e.last_seen_at, e.enrolled_at) DESC
        LIMIT 200
      `).bind(wallet).all();
      return fallback;
    });
    return c.json({ items: results || [] });
  });

  app.get('/api/me/subscriptions', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(`
      SELECT id, target_type, target_id, amount_usdc, period, status,
             current_period_end, cancel_at, tx_hash, created_at
      FROM subscriptions
      WHERE lower(subscriber_wallet) = ?
      ORDER BY (status = 'active') DESC, created_at DESC
      LIMIT 50
    `).bind(wallet).all();
    const items = results || [];
    const active = items.filter((s) => s.status === 'active');
    return c.json({ items, active_count: active.length });
  });

  app.get('/api/me/communities', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(`
      SELECT cm.id            AS membership_id,
             cm.community_id, cm.role, cm.tier, cm.status, cm.joined_at,
             co.slug, co.name, co.description, co.thumbnail_url,
             co.educator_wallet, co.educator_name, co.members_count,
             co.courses_count
      FROM community_members cm
      LEFT JOIN communities co ON co.id = cm.community_id
      WHERE lower(cm.wallet) = ? AND cm.status = 'active'
      ORDER BY cm.joined_at DESC
      LIMIT 200
    `).bind(wallet).all();
    return c.json({ items: results || [] });
  });

  app.get('/api/me/bookings', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(`
      SELECT b.id, b.consultant_wallet, b.topic, b.booking_date, b.time_slot,
             b.duration, b.price_usdc, b.status, b.escrow_status, b.escrow_tx,
             b.meeting_url, b.ends_at, b.service_id, b.created_at,
             s.title AS service_title,
             p.display_name AS consultant_name, p.avatar_url AS consultant_avatar
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN profiles p ON lower(p.wallet_address) = lower(b.consultant_wallet)
      WHERE lower(b.client_wallet) = ?
      ORDER BY b.booking_date DESC, b.created_at DESC
      LIMIT 100
    `).bind(wallet).all();
    const items = results || [];
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = items.filter((b) => (b.booking_date || '') >= today && b.status !== 'cancelled');
    const past     = items.filter((b) => (b.booking_date || '') <  today || b.status === 'cancelled');
    return c.json({ items, upcoming, past });
  });

  app.get('/api/me/referrals', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    const { results } = await c.env.DB.prepare(`
      SELECT id, referee_wallet, status, event_type, event_id, reward_usdc,
             payout_tx_hash, qualified_at, paid_at, created_at, source
      FROM referrals
      WHERE lower(referrer_wallet) = ?
      ORDER BY created_at DESC
      LIMIT 200
    `).bind(wallet).all();
    const items = results || [];
    const earned_usdc   = items.filter((r) => r.status === 'paid')
                               .reduce((s, r) => s + Number(r.reward_usdc || 0), 0);
    const pending_usdc  = items.filter((r) => r.status === 'qualified')
                               .reduce((s, r) => s + Number(r.reward_usdc || 0), 0);
    const signups_count = items.filter((r) => r.referee_wallet).length;
    return c.json({
      wallet,
      ref_link: `/?ref=${wallet}`,
      items, signups_count, earned_usdc, pending_usdc,
    });
  });

  app.get('/api/me/wallet', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    // Last 10 on-chain-flavoured rows we already index in D1. The full
    // RPC-backed tx history can be plugged in later behind the same shape.
    const { results: txs } = await c.env.DB.prepare(`
      SELECT id, tx_hash, amount_usdc, sender_wallet, recipient_wallet,
             description, status, created_at
      FROM revenue_tx
      WHERE lower(recipient_wallet) = ? OR lower(sender_wallet) = ?
      ORDER BY created_at DESC LIMIT 10
    `).bind(wallet, wallet).all();
    return c.json({ wallet, recent_tx: txs || [] });
  });

  app.get('/api/me/certificates', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    let issued = [];
    try {
      const { results } = await c.env.DB.prepare(`
        SELECT ci.id, ci.course_id, ci.token_id, ci.tx_hash, ci.r2_key,
               ci.created_at, co.title AS course_title, co.slug AS course_slug
        FROM certificates_issued ci
        LEFT JOIN courses co ON co.id = ci.course_id
        WHERE lower(ci.student_wallet) = ?
        ORDER BY ci.created_at DESC LIMIT 100
      `).bind(wallet).all();
      issued = results || [];
    } catch (_) { issued = []; }
    let mints = [];
    try {
      const { results } = await c.env.DB.prepare(`
        SELECT cm.id, cm.course_id, cm.token_id, cm.tx_hash, cm.status, cm.created_at,
               co.title AS course_title, co.slug AS course_slug
        FROM certificate_mints cm
        LEFT JOIN courses co ON co.id = cm.course_id
        WHERE lower(cm.recipient_wallet) = ?
        ORDER BY cm.created_at DESC LIMIT 100
      `).bind(wallet).all();
      mints = results || [];
    } catch (_) { mints = []; }
    return c.json({ issued, mints });
  });

  app.patch('/api/me/profile', learnerGate, async (c) => {
    const r = dbReady(c); if (r) return r;
    const wallet = lc(c.get('session')?.address);
    let body = {}; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    // Ensure a profile row exists (D1 has no upsert path elsewhere for this).
    const existing = await c.env.DB.prepare(
      'SELECT wallet_address FROM profiles WHERE wallet_address = ?'
    ).bind(wallet).first();
    if (!existing) {
      await c.env.DB.prepare(
        "INSERT INTO profiles (wallet_address, display_name) VALUES (?, ?)"
      ).bind(wallet, (body.display_name || '').toString().slice(0, 80) || null).run();
    }
    const sets = [], binds = [];
    if (typeof body.display_name === 'string') {
      sets.push('display_name = ?'); binds.push(body.display_name.slice(0, 80));
    }
    if (typeof body.email === 'string') {
      const e = body.email.trim().slice(0, 200);
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return c.json({ error: 'Invalid email' }, 400);
      sets.push('email = ?'); binds.push(e || null);
    }
    if (typeof body.bio === 'string') {
      sets.push('bio = ?'); binds.push(body.bio.slice(0, 4000));
    }
    if (typeof body.avatar_url === 'string') {
      sets.push('avatar_url = ?'); binds.push(body.avatar_url.slice(0, 500));
    }
    if (!sets.length) return c.json({ ok: true, noop: true });
    binds.push(wallet);
    await c.env.DB.prepare(
      `UPDATE profiles SET ${sets.join(', ')} WHERE wallet_address = ?`
    ).bind(...binds).run();
    const profile = await c.env.DB.prepare(
      'SELECT wallet_address, display_name, email, bio, avatar_url FROM profiles WHERE wallet_address = ?'
    ).bind(wallet).first();
    return c.json({ ok: true, profile });
  });
}
