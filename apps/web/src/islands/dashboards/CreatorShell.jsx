/**
 * CreatorShell — the shared sidebar/topbar wrapper for both the educator and
 * consultant workbenches (Phase 3b).
 *
 * Mounted via `<div data-island="CreatorShell" data-props='{"role":"educator","section":"courses"}'>`.
 * The Jekyll page sets `role` (educator|consultant) and `section`. The shell:
 *   - reads /admin/me-style identity via /api/auth/me
 *   - 401/403 splash for unauthorized callers
 *   - renders a left sidebar of role-appropriate sections + active pane
 *   - collapses the sidebar to a Dialog drawer at <640px (Bug F8 mobile pass)
 */

import React, { useEffect, useState } from 'react';
import { mountIsland } from '@lib/island.jsx';
import { api, ApiError } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Dialog, DialogContent } from '@ui/Dialog.jsx';
import { t, useLocale } from '@lib/i18n.js';

import EducatorCourses      from './educator/Courses.jsx';
import EducatorLessons      from './educator/Lessons.jsx';
import EducatorStudents     from './educator/Students.jsx';
import EducatorCertificates from './educator/Certificates.jsx';
import EducatorAnalytics    from './educator/Analytics.jsx';
import EducatorRevenue      from './educator/Revenue.jsx';

import ConsultantServices     from './consultant/Services.jsx';
import ConsultantAvailability from './consultant/Availability.jsx';
import ConsultantBookings     from './consultant/Bookings.jsx';

import SharedArticles    from './shared/Articles.jsx';
import SharedCommunities from './shared/Communities.jsx';
import SharedSettings    from './shared/Settings.jsx';

// Section labels resolve against window.TKNI18n at render time so the
// EN/TR/ES toggle in the footer reflows the sidebar without a reload.
const SECTIONS = {
  educator: [
    { id: 'courses',      labelKey: 'creator.sections.courses',      labelEn: 'Courses',      href: '/dashboard/educator/',              Component: EducatorCourses },
    { id: 'lessons',      labelKey: 'creator.sections.lessons',      labelEn: 'Lessons',      href: '/dashboard/educator/lessons/',      Component: EducatorLessons },
    { id: 'students',     labelKey: 'creator.sections.students',     labelEn: 'Students',     href: '/dashboard/educator/students/',     Component: EducatorStudents },
    { id: 'certificates', labelKey: 'creator.sections.certificates', labelEn: 'Certificates', href: '/dashboard/educator/certificates/', Component: EducatorCertificates },
    { id: 'articles',     labelKey: 'creator.sections.articles',     labelEn: 'Articles',     href: '/dashboard/educator/articles/',     Component: SharedArticles },
    { id: 'communities',  labelKey: 'creator.sections.communities',  labelEn: 'Communities',  href: '/dashboard/educator/communities/',  Component: SharedCommunities },
    { id: 'analytics',    labelKey: 'creator.sections.analytics',    labelEn: 'Analytics',    href: '/dashboard/educator/analytics/',    Component: EducatorAnalytics },
    { id: 'revenue',      labelKey: 'creator.sections.revenue',      labelEn: 'Revenue',      href: '/dashboard/educator/revenue/',      Component: EducatorRevenue },
    { id: 'settings',     labelKey: 'creator.sections.settings',     labelEn: 'Settings',     href: '/dashboard/educator/settings/',     Component: SharedSettings },
  ],
  consultant: [
    { id: 'services',     labelKey: 'creator.sections.services',     labelEn: 'Services',     href: '/dashboard/consultant/',             Component: ConsultantServices },
    { id: 'availability', labelKey: 'creator.sections.availability', labelEn: 'Availability', href: '/dashboard/consultant/availability/', Component: ConsultantAvailability },
    { id: 'bookings',     labelKey: 'creator.sections.bookings',     labelEn: 'Bookings',     href: '/dashboard/consultant/bookings/',    Component: ConsultantBookings },
    { id: 'articles',     labelKey: 'creator.sections.articles',     labelEn: 'Articles',     href: '/dashboard/consultant/articles/',    Component: SharedArticles },
    { id: 'communities',  labelKey: 'creator.sections.communities',  labelEn: 'Communities',  href: '/dashboard/consultant/communities/', Component: SharedCommunities },
    { id: 'revenue',      labelKey: 'creator.sections.revenue',      labelEn: 'Revenue',      href: '/dashboard/consultant/revenue/',     Component: EducatorRevenue },
    { id: 'analytics',    labelKey: 'creator.sections.analytics',    labelEn: 'Analytics',    href: '/dashboard/consultant/analytics/',   Component: EducatorAnalytics },
    { id: 'settings',     labelKey: 'creator.sections.settings',     labelEn: 'Settings',     href: '/dashboard/consultant/settings/',    Component: SharedSettings },
  ],
};

const ROLE_LABEL_KEY = { educator: 'creator.role.educator', consultant: 'creator.role.consultant' };
const ROLE_LABEL_EN  = { educator: 'Educator', consultant: 'Consultant' };
function roleLabel(role) { return t(ROLE_LABEL_KEY[role], ROLE_LABEL_EN[role]); }

export default function CreatorShell({ role = 'educator', section = '' }) {
  const sectionsRaw = SECTIONS[role] || SECTIONS.educator;
  const sections = sectionsRaw.map((s) => ({ ...s, label: t(s.labelKey, s.labelEn) }));
  const active = sections.find((s) => s.id === section) || sections[0];
  const [me, setMe] = useState({ loading: true, error: null, data: null });
  const [drawer, setDrawer] = useState(false);
  // Re-render when the user toggles the language so SECTIONS labels reflow.
  useLocale();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api('/api/auth/me', { credentials: 'include' });
        if (!cancelled) setMe({ loading: false, error: null, data });
      } catch (e) {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        setMe({ loading: false, error: { status, message: e.message, payload: e?.payload }, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (me.loading) return <Splash subtitle={t('creator.splash.verifying', 'Verifying your session…')} />;

  if (me.error?.status === 401 || (!me.data?.wallet)) {
    return (
      <Splash title={t('creator.splash.signin_title', 'Sign in required')}
        subtitle={t('creator.splash.signin_subtitle', 'Connect your wallet and sign in to access the workbench.')}>
        <Button onClick={() => (window.location.href = '/dashboard/')}>
          {t('wallet.connect', 'Connect wallet')}
        </Button>
      </Splash>
    );
  }

  const roles = me.data?.roles || [];
  const allowed = roles.includes(role) || roles.includes('admin');
  if (!allowed) {
    const label = roleLabel(role);
    return (
      <Splash title={t('creator.splash.not_role_title', 'Not a {role}').replace('{role}', label)}
        subtitle={t('creator.splash.not_role_subtitle',
          "Your wallet doesn't hold the {role} role yet. Apply from your profile to unlock this workbench.").replace(/\{role\}/g, label)}
        accent="danger">
        <div className="text-xs text-muted mt-2">
          {t('creator.splash.have_roles', 'Have:')} {roles.join(', ') || t('creator.roles.learner', 'learner')}
        </div>
        <Button className="mt-3" variant="outline" onClick={() => (window.location.href = '/profile/#consultant-registration')}>
          {t('creator.splash.apply_cta', 'Apply to become a {role}').replace('{role}', label)}
        </Button>
      </Splash>
    );
  }

  const Active = active.Component;
  const session = { address: me.data.wallet, exp: me.data.exp };
  const wallet = me.data.wallet;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-border bg-surface sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden -ml-1 p-2" aria-label={t('creator.nav.open', 'Open navigation')} onClick={() => setDrawer(true)}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
            <a href="/" className="font-bold tracking-tight">Tokenomic</a>
            <Badge variant="brand">{roleLabel(role)}</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="font-mono hidden sm:inline">{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>
            <a href="/dashboard/" className="text-brand hover:underline">{t('creator.nav.main_dashboard', 'Main dashboard')}</a>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <nav className="hidden md:block space-y-1">
          {sections.map((s) => (
            <a key={s.id} href={s.href}
              className={`flex items-center px-3 h-10 rounded-md text-sm transition-colors ${
                s.id === active.id ? 'bg-brand text-brand-fg font-semibold' : 'text-muted hover:text-fg hover:bg-surface2'
              }`}>{s.label}</a>
          ))}
        </nav>

        <Dialog open={drawer} onOpenChange={setDrawer}>
          <DialogContent className="max-w-xs ml-0 mr-auto h-full rounded-none">
            <div className="space-y-1 p-4">
              {sections.map((s) => (
                <a key={s.id} href={s.href}
                  className={`block px-3 h-10 leading-10 rounded-md text-sm ${
                    s.id === active.id ? 'bg-brand text-brand-fg font-semibold' : 'text-muted hover:text-fg hover:bg-surface2'
                  }`}>{s.label}</a>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <main className="min-w-0">
          <Active session={session} wallet={wallet} role={role} />
        </main>
      </div>
    </div>
  );
}

function Splash({ title, subtitle, accent, children }) {
  const resolvedTitle = title != null ? title : t('creator.splash.default_title', 'Workbench');
  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center px-6">
      <Card className="max-w-md w-full">
        <CardContent className="py-10 text-center space-y-3">
          <div className={'text-2xl font-bold ' + (accent === 'danger' ? 'text-danger' : '')}>{resolvedTitle}</div>
          {subtitle && <p className="text-muted">{subtitle}</p>}
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

mountIsland('CreatorShell', CreatorShell);
