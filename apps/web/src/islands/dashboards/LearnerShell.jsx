/**
 * LearnerShell — Phase 3c learner home (every signed-in wallet).
 *
 * Mirrors CreatorShell's sidebar/topbar pattern but is open to any
 * authenticated wallet (no role gate beyond a valid SIWE session).
 *
 * Mounted via `<div data-island="LearnerShell" data-props='{"section":"courses"}'>`.
 * Sections: courses | subscriptions | communities | bookings | referrals | wallet | settings
 */

import React, { useEffect, useState } from 'react';
import { mountIsland } from '@lib/island.jsx';
import { api, ApiError } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Dialog, DialogContent } from '@ui/Dialog.jsx';

import MyCourses     from './learner/MyCourses.jsx';
import MySubs        from './learner/MySubs.jsx';
import MyCommunities from './learner/MyCommunities.jsx';
import MyBookings    from './learner/MyBookings.jsx';
import MyReferrals   from './learner/MyReferrals.jsx';
import MyWallet      from './learner/MyWallet.jsx';
import Settings      from './learner/Settings.jsx';

const SECTIONS = [
  { id: 'courses',       label: 'My Courses',       href: '/dashboard/courses/',       Component: MyCourses },
  { id: 'subscriptions', label: 'My Subscriptions', href: '/dashboard/subscriptions/', Component: MySubs },
  { id: 'communities',   label: 'My Communities',   href: '/dashboard/communities/',   Component: MyCommunities },
  { id: 'bookings',      label: 'My Bookings',      href: '/dashboard/bookings/',      Component: MyBookings },
  { id: 'referrals',     label: 'My Referrals',     href: '/dashboard/referrals/',     Component: MyReferrals },
  { id: 'wallet',        label: 'Wallet',           href: '/dashboard/wallet/',        Component: MyWallet },
  { id: 'settings',      label: 'Settings',         href: '/dashboard/profile/',       Component: Settings },
];

export default function LearnerShell({ section = 'home' }) {
  const active = SECTIONS.find((s) => s.id === section) || null;
  const [me, setMe] = useState({ loading: true, error: null, data: null });
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api('/api/auth/me', { credentials: 'include' });
        if (!cancelled) setMe({ loading: false, error: null, data });
      } catch (e) {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        setMe({ loading: false, error: { status, message: e.message }, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (me.loading) return <Splash subtitle="Verifying your session…" />;

  if (me.error?.status === 401 || (!me.data?.wallet)) {
    return (
      <Splash title="Sign in required"
        subtitle="Connect your wallet and sign in to see your courses, subs, communities and bookings.">
        <Button onClick={() => (window.location.href = '/')}>Connect wallet</Button>
      </Splash>
    );
  }

  const wallet  = me.data.wallet;
  const roles   = me.data.roles || [];
  const session = { address: wallet, exp: me.data.exp };
  const Active  = active ? active.Component : null;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-border bg-surface sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden -ml-1 p-2" aria-label="Open navigation"
              onClick={() => setDrawer(true)}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
            <a href="/" className="font-bold tracking-tight">Tokenomic</a>
            <Badge variant="brand">Learner</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="font-mono hidden sm:inline">{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>
            {(roles.includes('educator') || roles.includes('admin')) && (
              <a href="/dashboard/educator/" className="text-brand hover:underline">Educator</a>
            )}
            {(roles.includes('consultant') || roles.includes('admin')) && (
              <a href="/dashboard/consultant/" className="text-brand hover:underline">Consultant</a>
            )}
            {roles.includes('admin') && (
              <a href="/dashboard/admin/" className="text-brand hover:underline">Admin</a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <nav className="hidden md:block space-y-1">
          {SECTIONS.map((s) => (
            <a key={s.id} href={s.href}
              className={`flex items-center px-3 h-10 rounded-md text-sm transition-colors ${
                active && s.id === active.id
                  ? 'bg-brand text-brand-fg font-semibold'
                  : 'text-muted hover:text-fg hover:bg-surface2'
              }`}>{s.label}</a>
          ))}
        </nav>

        <Dialog open={drawer} onOpenChange={setDrawer}>
          <DialogContent className="max-w-xs ml-0 mr-auto h-full rounded-none">
            <div className="space-y-1 p-4">
              {SECTIONS.map((s) => (
                <a key={s.id} href={s.href}
                  className={`block px-3 h-10 leading-10 rounded-md text-sm ${
                    active && s.id === active.id
                      ? 'bg-brand text-brand-fg font-semibold'
                      : 'text-muted hover:text-fg hover:bg-surface2'
                  }`}>{s.label}</a>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <main className="min-w-0">
          {Active
            ? <Active session={session} wallet={wallet} roles={roles} />
            : <LearnerHome wallet={wallet} roles={roles} />
          }
        </main>
      </div>
    </div>
  );
}

function LearnerHome({ wallet, roles }) {
  const [data, setData] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, s, b] = await Promise.all([
          api('/api/me/courses',       { credentials: 'include' }).catch(() => ({ items: [] })),
          api('/api/me/subscriptions', { credentials: 'include' }).catch(() => ({ items: [], active_count: 0 })),
          api('/api/me/bookings',      { credentials: 'include' }).catch(() => ({ upcoming: [] })),
        ]);
        if (cancelled) return;
        setData({
          loading: false,
          courses: c.items || [],
          subs: s.items || [],
          active_subs: s.active_count || 0,
          upcoming_bookings: b.upcoming || [],
        });
      } catch {
        if (!cancelled) setData({ loading: false, courses: [], subs: [], active_subs: 0, upcoming_bookings: [] });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (data.loading) return <div className="text-muted text-sm">Loading…</div>;

  const continueWatching = (data.courses || []).filter((e) => (e.progress || 0) < 100).slice(0, 4);
  const certs = (data.courses || []).filter((e) => e.cert_token_id || (e.progress || 0) >= 100).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Welcome back</h1>
        <p className="text-sm text-muted">Pick up where you left off, or jump into a community.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Enrolled" value={data.courses.length} />
        <Stat label="Certificates" value={certs} />
        <Stat label="Active subs" value={data.active_subs} />
        <Stat label="Upcoming sessions" value={data.upcoming_bookings.length} />
      </div>

      <Card><CardContent>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Continue learning</h2>
          <a href="/dashboard/courses/" className="text-xs text-brand hover:underline">View all</a>
        </div>
        {continueWatching.length === 0 ? (
          <EmptyHint cta="Browse courses" href="/courses/">
            No courses in progress yet — pick one to get started.
          </EmptyHint>
        ) : (
          <div className="space-y-2">
            {continueWatching.map((e) => (
              <a key={e.enrollment_id || e.course_id}
                href={e.slug ? `/courses/${e.slug}` : '#'}
                className="flex items-center gap-3 p-3 rounded-md hover:bg-surface2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{e.title || 'Untitled'}</div>
                  <div className="text-xs text-muted">Progress {e.progress || 0}%</div>
                </div>
                <div className="w-24 h-1.5 bg-surface2 rounded overflow-hidden">
                  <div className="h-full bg-brand" style={{ width: `${Math.min(100, e.progress || 0)}%` }} />
                </div>
              </a>
            ))}
          </div>
        )}
      </CardContent></Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent>
          <h2 className="font-semibold mb-2">Upcoming sessions</h2>
          {data.upcoming_bookings.length === 0 ? (
            <EmptyHint cta="Find an expert" href="/experts/">
              No bookings on the calendar yet.
            </EmptyHint>
          ) : (
            <ul className="text-sm space-y-2">
              {data.upcoming_bookings.slice(0, 3).map((b) => (
                <li key={b.id} className="flex justify-between gap-3">
                  <span className="truncate">{b.service_title || b.topic || 'Session'}</span>
                  <span className="text-muted">{b.booking_date} {b.time_slot || ''}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent></Card>

        <Card><CardContent>
          <h2 className="font-semibold mb-2">Subscriptions</h2>
          {data.active_subs === 0 ? (
            <EmptyHint cta="See plans" href="/pricing/">
              No active subscription yet.
            </EmptyHint>
          ) : (
            <p className="text-sm text-muted">{data.active_subs} active subscription{data.active_subs === 1 ? '' : 's'}.</p>
          )}
        </CardContent></Card>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <Card><CardContent>
      <div className="text-2xl font-bold text-fg">{value ?? 0}</div>
      <div className="text-xs text-muted">{label}</div>
    </CardContent></Card>
  );
}

function EmptyHint({ children, cta, href }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">
      <p className="mb-2">{children}</p>
      {cta && <a href={href} className="text-brand hover:underline">{cta} →</a>}
    </div>
  );
}

function Splash({ title = 'Dashboard', subtitle, accent, children }) {
  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center px-6">
      <Card className="max-w-md w-full">
        <CardContent className="py-10 text-center space-y-3">
          <div className={'text-2xl font-bold ' + (accent === 'danger' ? 'text-danger' : '')}>{title}</div>
          {subtitle && <p className="text-muted">{subtitle}</p>}
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

mountIsland('LearnerShell', LearnerShell);
