/**
 * Phase 3a — login-aware auth middleware.
 *
 * Wraps the SIWE cookie session (`tk_session`, see ./siwe.js) and the
 * on-chain RoleRegistry reader (./role-registry.js) into a single, ergonomic
 * `requireRole(roleOrRoles)` middleware.
 *
 *   import { requireRole, resolveSession } from './auth.js';
 *
 *   app.get('/admin/users',  requireRole('admin'),    handler);
 *   app.get('/dashboard',    requireRole(['educator','consultant','admin']), handler);
 *
 * Resolution rules:
 *   - 401 if no valid SIWE cookie is present.
 *   - 403 if the cookie is valid but the wallet does not hold any of the
 *     requested roles.
 *   - For role 'admin', authorization is STRICTLY gated by the env-pinned
 *     `ADMIN_WALLETS` allowlist. On-chain DEFAULT_ADMIN_ROLE / PLATFORM_ROLE
 *     are NOT sufficient on their own — the wallet must also appear in the
 *     allowlist. This keeps the operator set narrow and prevents a leaked
 *     contract admin key from quietly unlocking the dashboard.
 *   - Roles other than 'admin' must come from the on-chain RoleRegistry.
 *     The legacy `profiles.roles` JSON column is honored as a fallback so
 *     environments without a deployed RoleRegistry still work.
 *
 * On success the handler may read:
 *   c.get('session')  -> { address, exp }
 *   c.get('roles')    -> ['learner', 'educator', ...]   (deduped, lowercased)
 *   c.get('isAdmin')  -> boolean
 */

import { readSessionFromCookie } from './siwe.js';
import { readRoles } from './role-registry.js';

function lc(s) { return (s || '').toString().toLowerCase(); }
function isHexAddress(s) { return /^0x[0-9a-fA-F]{40}$/.test(s || ''); }

function adminAllowlist(env) {
  return (env.ADMIN_WALLETS || '')
    .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve the full identity for the current request: session + roles +
 * admin status. Returns `null` when there's no SIWE cookie. Never throws.
 *
 * Role union:
 *   - on-chain RoleRegistry (cached 60s)
 *   - env ADMIN_WALLETS  (always grants 'admin')
 *   - profiles.roles JSON column (legacy fallback)
 */
export async function resolveSession(c) {
  const session = await readSessionFromCookie(c);
  if (!session || !isHexAddress(session.address)) return null;
  const wallet = lc(session.address);

  const roles = new Set(['learner']);

  // 1) on-chain RoleRegistry (educator / consultant / platform / treasury).
  //    NOTE: any 'admin' bit returned from on-chain is intentionally dropped
  //    here. Admin authority is granted ONLY via the env allowlist below;
  //    this keeps a leaked DEFAULT_ADMIN_ROLE key from unlocking the
  //    dashboard without operator action.
  try {
    const onChain = await readRoles(c.env, wallet);
    for (const r of onChain.roles || []) {
      if (r !== 'admin') roles.add(r);
    }
  } catch (_) { /* on-chain read is best-effort */ }

  // 2) legacy D1 profiles.roles JSON (also drops 'admin' for the same reason).
  if (c.env.DB) {
    try {
      const row = await c.env.DB.prepare(
        'SELECT roles FROM profiles WHERE wallet_address = ?'
      ).bind(wallet).first();
      if (row && typeof row.roles === 'string') {
        try {
          const parsed = JSON.parse(row.roles);
          if (Array.isArray(parsed)) {
            for (const r of parsed) {
              const v = String(r);
              if (v !== 'admin') roles.add(v);
            }
          }
        } catch { /* ignore */ }
      }
    } catch (_) { /* DB not bound on some preview envs */ }
  }

  // 3) env-pinned admin allowlist — the SOLE source of the 'admin' role.
  const allow = adminAllowlist(c.env);
  const isAdmin = allow.includes(wallet);
  if (isAdmin) roles.add('admin');

  return {
    wallet,
    exp: session.exp,
    roles: Array.from(roles),
    isAdmin,
  };
}

/**
 * Hono middleware factory. Use as:
 *   app.get('/admin/x', requireRole('admin'), handler);
 *   app.get('/edu/x',   requireRole(['educator','admin']), handler);
 *
 * Stashes the resolved identity on the context so handlers don't repeat the
 * same lookups.
 */
export function requireRole(roleOrRoles) {
  const wanted = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  const wantedSet = new Set(wanted.map((r) => String(r).toLowerCase()));
  const adminWanted = wantedSet.has('admin');

  return async (c, next) => {
    const id = await resolveSession(c);
    if (!id) return c.json({ error: 'Sign in required' }, 401);

    // Admin gate: STRICT allowlist match. The on-chain DEFAULT_ADMIN_ROLE
    // is intentionally not sufficient — see resolveSession() for rationale.
    if (adminWanted && !id.isAdmin) {
      return c.json(
        { error: 'Forbidden — wallet is not in ADMIN_WALLETS allowlist',
          required: ['admin'], have: id.roles },
        403,
      );
    }
    let granted = adminWanted && id.isAdmin;
    if (!granted) {
      for (const r of id.roles) if (wantedSet.has(r)) { granted = true; break; }
    }

    if (!granted) {
      return c.json(
        {
          error: 'Forbidden — missing required role',
          required: Array.from(wantedSet),
          have: id.roles,
        },
        403,
      );
    }

    c.set('session', { address: id.wallet, exp: id.exp });
    c.set('roles', id.roles);
    c.set('isAdmin', id.isAdmin);
    return next();
  };
}

/**
 * Read-only convenience: returns the resolved identity (or null) without
 * 401-ing. Used by /admin/me and any UI route that wants to render the
 * current user's role set.
 */
export async function whoami(c) {
  const id = await resolveSession(c);
  if (!id) return null;
  return id;
}
