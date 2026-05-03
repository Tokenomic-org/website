/**
 * Phase 3a — admin console JSON API.
 *
 * Mounted under `/admin/*`. Every endpoint is gated by `requireRole('admin')`,
 * which combines the SIWE cookie, the on-chain RoleRegistry, AND the
 * env-pinned `ADMIN_WALLETS` allowlist (see ./auth.js).
 *
 * Endpoints:
 *   GET  /admin/me                                   session + roles
 *   GET  /admin/role-registry                        deployed addr + chain id
 *   GET  /admin/users?q=<wallet|ens>                 search profiles
 *   POST /admin/users/:wallet/role/confirm           record an off-the-wire grant/revoke
 *   GET  /admin/approvals                            pending applications
 *   POST /admin/approvals/:id/approve                grant role + audit
 *   POST /admin/approvals/:id/reject                 audit rejection
 *   GET  /admin/approvals/:id/docs                   list KYC docs (R2 keys)
 *   GET  /admin/approvals/:id/docs/:key              stream KYC doc from R2
 *   GET  /admin/moderation?type=&q=                  list courses/articles/communities
 *   POST /admin/moderation/:type/:id/hide            soft-delete via D1 flag
 *   POST /admin/moderation/:type/:id/unhide          restore
 *   GET  /admin/revenue                              D1 + on-chain aggregates
 *   GET  /admin/audit?limit=&before=                 paginated audit_log read
 *
 * Every state-changing call writes a row into `audit_log` with the signing
 * wallet, action verb, target id, optional tx_hash, and timestamp.
 */

import { createPublicClient, http } from 'viem';
import { requireRole, whoami } from './auth.js';
import { invalidateRolesCache, getRoleRegistryConfig, ROLE_HASH } from './role-registry.js';

function lc(s) { return (s || '').toString().toLowerCase(); }
function isHexAddress(s) { return /^0x[0-9a-fA-F]{40}$/.test(s || ''); }
function isTxHash(s)     { return /^0x[0-9a-fA-F]{64}$/.test(s || ''); }
function jsonOrNull(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

const MOD_TYPES = {
  courses:     { table: 'courses',     ownerCol: 'educator_wallet', titleCol: 'title' },
  articles:    { table: 'articles',    ownerCol: 'author_wallet',   titleCol: 'title' },
  communities: { table: 'communities', ownerCol: 'educator_wallet', titleCol: 'name'  },
};

async function audit(env, actor, action, target_type, target_id, metadata, tx_hash) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT INTO audit_log (actor_wallet, action, target_type, target_id, metadata, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      actor, action, target_type || null, String(target_id || ''),
      metadata ? JSON.stringify(metadata) : null,
      tx_hash || null,
    ).run();
  } catch (_) { /* never throw from audit */ }
}

const ERC20_BALANCE_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
];

export function mountAdminRoutes(app) {

  // -------- session / config (no auth: returns 401 vs 200 to drive UI) --------

  app.get('/admin/me', async (c) => {
    const id = await whoami(c);
    if (!id) return c.json({ ok: false, error: 'Sign in required' }, 401);
    // Strict admin gate: must be in the env ADMIN_WALLETS allowlist.
    if (!id.isAdmin) {
      return c.json(
        { ok: false, error: 'Not in ADMIN_WALLETS allowlist',
          wallet: id.wallet, roles: id.roles },
        403,
      );
    }
    return c.json({
      ok: true,
      wallet: id.wallet,
      roles: id.roles,
      isAdmin: true,
      sessionExp: id.exp,
    });
  });

  app.get('/admin/role-registry', requireRole('admin'), (c) => {
    const cfg = getRoleRegistryConfig(c.env);
    return c.json({
      address: cfg.address || null,
      chainId: cfg.chainId,
      rpcUrl:  cfg.rpcUrl,
      // Bytes32 role ids the client needs to build calldata for grantRole/revokeRole.
      roles: {
        EDUCATOR_ROLE:      ROLE_HASH.EDUCATOR_ROLE,
        CONSULTANT_ROLE:    ROLE_HASH.CONSULTANT_ROLE,
        PLATFORM_ROLE:      ROLE_HASH.PLATFORM_ROLE,
        TREASURY_ROLE:      ROLE_HASH.TREASURY_ROLE,
        DEFAULT_ADMIN_ROLE: ROLE_HASH.DEFAULT_ADMIN_ROLE,
      },
    });
  });

  // -------- users --------

  app.get('/admin/users', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);
    const q = (c.req.query('q') || '').trim().toLowerCase();
    let rows = [];
    if (!q) {
      const r = await c.env.DB.prepare(
        'SELECT wallet_address, display_name, role, roles, approved, email, last_active_at FROM profiles ORDER BY last_active_at DESC LIMIT 50'
      ).all();
      rows = r.results || [];
    } else {
      // Match on wallet, display_name, ENS (display_name often holds ENS too), email.
      const like = `%${q}%`;
      const r = await c.env.DB.prepare(
        `SELECT wallet_address, display_name, role, roles, approved, email, last_active_at
         FROM profiles
         WHERE LOWER(wallet_address) LIKE ?
            OR LOWER(IFNULL(display_name, '')) LIKE ?
            OR LOWER(IFNULL(email, '')) LIKE ?
         ORDER BY last_active_at DESC LIMIT 50`
      ).bind(like, like, like).all();
      rows = r.results || [];
    }
    return c.json({
      ok: true,
      items: rows.map((r) => ({ ...r, roles: jsonOrNull(r.roles) || (r.role ? [r.role] : ['learner']) })),
      count: rows.length,
    });
  });

  /**
   * Confirm an off-chain submitted RoleRegistry grant/revoke. The actual
   * grantRole/revokeRole transaction is signed and broadcast by the connected
   * admin wallet via Wagmi in the browser; the server only writes the audit
   * row + invalidates the cached on-chain role set.
   *
   * Body:
   *   { action: 'grant'|'revoke', role: 'EDUCATOR_ROLE'|..., tx_hash: '0x…' }
   */
  app.post('/admin/users/:wallet/role/confirm', requireRole('admin'), async (c) => {
    const target = lc(c.req.param('wallet'));
    if (!isHexAddress(target)) return c.json({ error: 'Invalid wallet' }, 400);
    let body = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const action = body.action === 'revoke' ? 'revoke' : 'grant';
    const role   = String(body.role || '').toUpperCase();
    const tx     = body.tx_hash;
    if (!ROLE_HASH[role]) return c.json({ error: 'Unknown role' }, 400);
    if (!isTxHash(tx))    return c.json({ error: 'Invalid tx_hash' }, 400);

    const session = c.get('session');
    await audit(c.env, session.address, `role.${action}`, 'wallet', target,
                { role, action }, tx);
    await invalidateRolesCache(c.env, target);
    return c.json({ ok: true, action, role, target, tx_hash: tx });
  });

  // -------- approvals --------

  app.get('/admin/approvals', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);
    const r = await c.env.DB.prepare(
      "SELECT * FROM applications WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100"
    ).all();
    return c.json({ ok: true, items: r.results || [], count: (r.results || []).length });
  });

  /**
   * Approve an application. Phase 3a couples approval to an on-chain role
   * grant: the admin UI signs a `RoleRegistry.grantRole(role, applicant)`
   * transaction via wagmi, then POSTs the resulting tx_hash here. The
   * worker enforces that a 32-byte tx_hash is present (unless the env
   * RoleRegistry is unconfigured, in which case we accept off-chain
   * approvals as a development convenience and record metadata.note).
   *
   * Body: { tx_hash: '0x…' }
   */
  app.post('/admin/approvals/:id/approve', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    let body = {}; try { body = await c.req.json(); } catch {}
    const tx_hash = typeof body.tx_hash === 'string' ? body.tx_hash : null;
    const registryConfigured = !!c.env.ROLE_REGISTRY;
    if (registryConfigured && !isTxHash(tx_hash)) {
      // Surface the calldata the UI must sign so the next attempt can
      // succeed without an extra round-trip.
      return c.json({
        error: 'tx_hash required — sign RoleRegistry.grantRole first',
        registry: c.env.ROLE_REGISTRY,
      }, 400);
    }

    const appRow = await c.env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first();
    if (!appRow) return c.json({ error: 'Application not found' }, 404);
    if (appRow.status !== 'pending') return c.json({ error: 'Already reviewed' }, 409);

    const session = c.get('session');
    const target  = lc(appRow.applicant_wallet);
    const newRole = appRow.role_requested === 'consultant' ? 'consultant' : 'educator';

    // Mirror the legacy approval: append role to profile JSON + flag approved.
    const existing = await c.env.DB.prepare('SELECT * FROM profiles WHERE wallet_address = ?').bind(target).first();
    let roles = existing && existing.roles ? jsonOrNull(existing.roles) : null;
    if (!Array.isArray(roles)) roles = ['learner'];
    if (!roles.includes(newRole)) roles.push(newRole);
    const rolesJson = JSON.stringify(roles);

    if (existing) {
      await c.env.DB.prepare(
        'UPDATE profiles SET roles = ?, role = ?, approved = 1 WHERE wallet_address = ?'
      ).bind(rolesJson, newRole, target).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO profiles (wallet_address, role, roles, approved) VALUES (?, ?, ?, 1)'
      ).bind(target, newRole, rolesJson).run();
    }

    await c.env.DB.prepare(`
      UPDATE applications
      SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), admin_feedback = NULL
      WHERE id = ?
    `).bind(session.address, id).run();

    await audit(c.env, session.address, 'application.approved', 'application', id,
                { applicant: target, role: newRole, on_chain: !!tx_hash,
                  note: registryConfigured ? null : 'RoleRegistry not configured' },
                tx_hash);
    await invalidateRolesCache(c.env, target);

    return c.json({ ok: true, id, status: 'approved', granted_role: newRole,
                    target, tx_hash: tx_hash || null });
  });

  app.post('/admin/approvals/:id/reject', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    let body = {}; try { body = await c.req.json(); } catch {}
    const feedback = (body.admin_feedback || '').toString().trim();
    if (feedback.length < 10) return c.json({ error: 'admin_feedback (≥10 chars) required' }, 400);

    const appRow = await c.env.DB.prepare('SELECT id, status FROM applications WHERE id = ?').bind(id).first();
    if (!appRow) return c.json({ error: 'Application not found' }, 404);
    if (appRow.status !== 'pending') return c.json({ error: 'Already reviewed' }, 409);

    const session = c.get('session');
    await c.env.DB.prepare(`
      UPDATE applications
      SET status = 'rejected', admin_feedback = ?, reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).bind(feedback.slice(0, 2000), session.address, id).run();
    await audit(c.env, session.address, 'application.rejected', 'application', id,
                { feedback: feedback.slice(0, 200) });
    return c.json({ ok: true, id, status: 'rejected' });
  });

  // KYC documents are uploaded to R2 by the /apply flow under
  // `applications/<id>/<filename>`. Listing + streaming is gated by admin auth.
  app.get('/admin/approvals/:id/docs', requireRole('admin'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    if (!c.env.KYC_BUCKET) {
      return c.json({ ok: true, items: [], note: 'R2 KYC_BUCKET not bound on this env' });
    }
    const list = await c.env.KYC_BUCKET.list({ prefix: `applications/${id}/` });
    return c.json({
      ok: true,
      items: (list.objects || []).map((o) => ({
        key:  o.key,
        size: o.size,
        uploaded: o.uploaded,
      })),
    });
  });

  app.get('/admin/approvals/:id/docs/:key{.+}', requireRole('admin'), async (c) => {
    const id  = Number(c.req.param('id'));
    const key = c.req.param('key');
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    if (!c.env.KYC_BUCKET) return c.json({ error: 'R2 not bound' }, 503);
    // Pin the key under the application prefix to prevent path traversal.
    const fullKey = `applications/${id}/${key.replace(/^.*\//, '')}`;
    const obj = await c.env.KYC_BUCKET.get(fullKey);
    if (!obj) return c.json({ error: 'Not found' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename="${fullKey.split('/').pop()}"`);
    return new Response(obj.body, { headers });
  });

  // -------- moderation --------

  app.get('/admin/moderation', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);
    const type = c.req.query('type');
    if (!MOD_TYPES[type]) return c.json({ error: 'type must be one of: ' + Object.keys(MOD_TYPES).join(', ') }, 400);
    const cfg = MOD_TYPES[type];
    const q = (c.req.query('q') || '').trim().toLowerCase();
    let rows;
    if (!q) {
      rows = await c.env.DB.prepare(
        `SELECT id, slug, ${cfg.titleCol} AS title, ${cfg.ownerCol} AS owner, status, created_at
         FROM ${cfg.table} ORDER BY created_at DESC LIMIT 100`
      ).all();
    } else {
      const like = `%${q}%`;
      rows = await c.env.DB.prepare(
        `SELECT id, slug, ${cfg.titleCol} AS title, ${cfg.ownerCol} AS owner, status, created_at
         FROM ${cfg.table}
         WHERE LOWER(IFNULL(${cfg.titleCol}, '')) LIKE ?
            OR LOWER(IFNULL(slug, '')) LIKE ?
            OR LOWER(IFNULL(${cfg.ownerCol}, '')) LIKE ?
         ORDER BY created_at DESC LIMIT 100`
      ).bind(like, like, like).all();
    }
    return c.json({ ok: true, type, items: rows.results || [], count: (rows.results || []).length });
  });

  app.post('/admin/moderation/:type/:id/:op{(hide|unhide)}', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);
    const type = c.req.param('type');
    const op   = c.req.param('op');
    const id   = Number(c.req.param('id'));
    if (!MOD_TYPES[type]) return c.json({ error: 'Bad type' }, 400);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const cfg = MOD_TYPES[type];
    const row = await c.env.DB.prepare(`SELECT id, status FROM ${cfg.table} WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: `${type} not found` }, 404);

    const newStatus = op === 'hide'
      ? 'hidden'
      : (type === 'articles' ? 'published' : 'active');

    const session = c.get('session');
    await c.env.DB.prepare(
      `UPDATE ${cfg.table} SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).bind(newStatus, session.address, id).run();

    await audit(c.env, session.address, `${type}.${op}`, type, id, { previous: row.status });
    return c.json({ ok: true, id, type, status: newStatus });
  });

  // -------- revenue --------

  app.get('/admin/revenue', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);

    // D1 aggregates. Defensive guards: subscriptions / revenue tables may not
    // exist in all environments — count() ... or 0 keeps the response shape
    // stable for the frontend.
    const safe = async (sql, fallback) => {
      try { const r = await c.env.DB.prepare(sql).first(); return r || fallback; }
      catch { return fallback; }
    };

    const [subs, revenue, topEducators] = await Promise.all([
      safe("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active'", { n: 0 }),
      safe('SELECT COALESCE(SUM(amount_usdc), 0) AS total FROM subscriptions', { total: 0 }),
      (async () => {
        try {
          const r = await c.env.DB.prepare(`
            SELECT educator_wallet AS wallet,
                   COUNT(*)         AS courses,
                   COALESCE(SUM(price_usdc), 0) AS total_priced
            FROM courses
            WHERE status = 'active'
            GROUP BY educator_wallet
            ORDER BY total_priced DESC
            LIMIT 10
          `).all();
          return r.results || [];
        } catch { return []; }
      })(),
    ]);

    // On-chain reads. Keep them tiny and cached only by viem's transport.
    let usdcTreasury = null;
    try {
      const treasury = c.env.PLATFORM_TREASURY;
      const usdc     = c.env.USDC_BASE;
      if (isHexAddress(treasury) && isHexAddress(usdc)) {
        const cfg = getRoleRegistryConfig(c.env);
        const client = createPublicClient({ transport: http(cfg.rpcUrl) });
        const bal = await client.readContract({
          address: usdc,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [treasury],
        });
        usdcTreasury = (Number(bal) / 1e6).toString();
      }
    } catch (_) { /* leave null */ }

    return c.json({
      ok: true,
      d1: {
        activeSubscriptions: Number(subs.n || 0),
        totalUsdcProcessed:  Number(revenue.total || 0),
        topEducators,
      },
      onChain: {
        treasuryUsdc: usdcTreasury,
        treasury:     c.env.PLATFORM_TREASURY || null,
      },
      ts: Date.now(),
    });
  });

  // -------- audit log --------

  app.get('/admin/audit', requireRole('admin'), async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 not bound' }, 503);
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)));
    const before = Number(c.req.query('before') || 0);
    let rows;
    if (before > 0) {
      rows = await c.env.DB.prepare(
        'SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?'
      ).bind(before, limit).all();
    } else {
      rows = await c.env.DB.prepare(
        'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'
      ).bind(limit).all();
    }
    const items = (rows.results || []).map((r) => ({
      ...r,
      metadata: jsonOrNull(r.metadata),
    }));
    return c.json({
      ok: true,
      items,
      count: items.length,
      nextBefore: items.length ? items[items.length - 1].id : null,
    });
  });
}
