/**
 * AdminConsole — Phase 3a admin shell.
 *
 * Loads /admin/me to check the SIWE session + role gate. Renders a 401/403
 * fallback for non-admins (clean, branded, no leakage of internal state).
 * For admins, renders a sidebar + module switcher with five panels:
 * Users, Approvals, Moderation, Revenue, AuditLog.
 *
 * The panel components live in ./admin/* and only consume the JSON API; no
 * cross-panel state is shared, so each section can evolve independently.
 */

import React, { useEffect, useState } from 'react';
import { mountIsland } from '@lib/island.jsx';
import { api, ApiError, getApiBase } from '@lib/api.js';
import { Button } from '@ui/Button.jsx';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';

import Users      from './admin/Users.jsx';
import Approvals  from './admin/Approvals.jsx';
import Moderation from './admin/Moderation.jsx';
import Revenue    from './admin/Revenue.jsx';
import AuditLog   from './admin/AuditLog.jsx';

const SECTIONS = [
  { id: 'approvals',  label: 'Approvals',     icon: '✓', Component: Approvals },
  { id: 'users',      label: 'Users & Roles', icon: '◎', Component: Users },
  { id: 'moderation', label: 'Moderation',    icon: '⚑', Component: Moderation },
  { id: 'revenue',    label: 'Revenue',       icon: '＄', Component: Revenue },
  { id: 'audit',      label: 'Audit Log',     icon: '⌘', Component: AuditLog },
];

export default function AdminConsole() {
  const [me, setMe] = useState({ loading: true, error: null, data: null });
  const [active, setActive] = useState(() => {
    if (typeof window === 'undefined') return 'approvals';
    const m = window.location.hash.replace(/^#/, '');
    return SECTIONS.find((s) => s.id === m) ? m : 'approvals';
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api('/admin/me', { credentials: 'include' });
        if (!cancelled) setMe({ loading: false, error: null, data });
      } catch (e) {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        setMe({ loading: false, error: { status, message: e.message, payload: e?.payload }, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onHash = () => {
      const m = window.location.hash.replace(/^#/, '');
      if (SECTIONS.find((s) => s.id === m)) setActive(m);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (me.loading) return <Splash subtitle="Verifying admin session…" />;

  if (me.error?.status === 401) {
    return (
      <Splash
        title="Sign in required"
        subtitle="Connect your wallet and sign the SIWE message to access the admin console."
      >
        <Button onClick={() => (window.location.href = '/dashboard/')}>Connect wallet</Button>
      </Splash>
    );
  }
  if (me.error?.status === 403 || (me.data && me.data.isAdmin === false)) {
    const payload = me.error?.payload || me.data || {};
    return (
      <Splash
        title="403 — Not authorized"
        subtitle="This wallet does not hold the admin role."
        accent="danger"
      >
        <div className="text-xs text-muted mt-3 break-all">
          {payload.wallet || ''}
          {Array.isArray(payload.roles) && payload.roles.length > 0 && (
            <span> · roles: {payload.roles.join(', ')}</span>
          )}
        </div>
      </Splash>
    );
  }
  if (me.error) {
    return (
      <Splash title="Service unavailable" subtitle={me.error.message || 'Could not reach the admin API.'} accent="danger">
        <code className="text-xs text-muted">{getApiBase()}/admin/me</code>
      </Splash>
    );
  }

  const ActivePanel = (SECTIONS.find((s) => s.id === active) || SECTIONS[0]).Component;
  const meta = me.data;

  const onLogout = async () => {
    try { await api('/api/siwe/logout', { method: 'POST', credentials: 'include' }); } catch {}
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-border bg-surface sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a href="/" className="font-bold tracking-tight">Tokenomic</a>
            <Badge variant="brand">Admin</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="font-mono hidden sm:inline">
              {meta.wallet.slice(0, 6)}…{meta.wallet.slice(-4)}
            </span>
            <Button size="sm" variant="outline" onClick={onLogout}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        <nav className="space-y-1">
          {SECTIONS.map((s) => {
            const isActive = s.id === active;
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => { e.preventDefault(); window.location.hash = s.id; setActive(s.id); }}
                className={
                  'flex items-center gap-3 px-3 h-10 rounded-md text-sm transition-colors ' +
                  (isActive
                    ? 'bg-brand text-brand-fg font-semibold'
                    : 'text-muted hover:text-fg hover:bg-surface2')
                }
              >
                <span className="w-5 text-center">{s.icon}</span>
                <span>{s.label}</span>
              </a>
            );
          })}
          <div className="pt-6 text-xs text-muted px-3">
            <div>Roles</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(meta.roles || []).map((r) => <Badge key={r} variant="outline">{r}</Badge>)}
            </div>
          </div>
        </nav>

        <main className="min-w-0">
          <ActivePanel session={meta} />
        </main>
      </div>
    </div>
  );
}

function Splash({ title = 'Admin Console', subtitle, accent, children }) {
  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center px-6">
      <Card className="max-w-md w-full">
        <CardContent className="py-10 text-center space-y-3">
          <div className={'text-3xl font-bold ' + (accent === 'danger' ? 'text-danger' : '')}>{title}</div>
          {subtitle && <p className="text-muted">{subtitle}</p>}
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

mountIsland('AdminConsole', AdminConsole);
