import React, { useEffect, useMemo, useState } from 'react';
import { mountIsland } from '@lib/island.jsx';
import { api, ApiError } from '@lib/api.js';
import { useUrlState } from '@lib/url-state.js';
import { useInfiniteScroll } from '@lib/use-infinite-scroll.js';
import { t, tf, useLocale } from '@lib/i18n.js';
import { Tabs, TabsList, TabsTrigger } from '@ui/Tabs.jsx';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Select } from '@ui/Select.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Avatar } from '@ui/Avatar.jsx';
import { Skeleton, SkeletonText } from '@ui/Skeleton.jsx';

function buildSort() {
  return [
    { value: 'recent',    label: t('experts.filters.sort_recent', 'Recently active') },
    { value: 'rate-asc',  label: t('experts.filters.sort_rate_asc', 'Rate ↑') },
    { value: 'rate-desc', label: t('experts.filters.sort_rate_desc', 'Rate ↓') },
    { value: 'alpha',     label: t('experts.filters.sort_alpha', 'A → Z') },
  ];
}

const PAGE = 12;

function ExpertsDirectory() {
  useLocale();
  const [state, setState] = useUrlState({ tab: 'all', q: '', sort: 'recent' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => { setShown(PAGE); }, [state.tab, state.q, state.sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api('/api/experts')
      .then((r) => { if (alive) setItems(Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])); })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e.message : String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = state.q.trim().toLowerCase();
    let out = items.filter((e) => {
      const role = (e.role || '').toLowerCase();
      if (state.tab === 'consultants' && role !== 'consultant') return false;
      if (state.tab === 'educators'   && role !== 'educator')   return false;
      if (q) {
        const hay = `${e.display_name || ''} ${e.specialty || ''} ${e.bio || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const rate = (x) => Number(x.rate_30 || x.rate_60 || 0);
    switch (state.sort) {
      case 'rate-asc':  out.sort((a, b) => rate(a) - rate(b)); break;
      case 'rate-desc': out.sort((a, b) => rate(b) - rate(a)); break;
      case 'alpha':     out.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')); break;
      default:          out.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    }
    return out;
  }, [items, state]);

  const visible = filtered.slice(0, shown);
  const sentinelRef = useInfiniteScroll(
    () => setShown((s) => Math.min(s + PAGE, filtered.length)),
    { enabled: shown < filtered.length },
  );

  const counts = useMemo(() => {
    const c = { all: items.length, consultants: 0, educators: 0 };
    for (const e of items) {
      const r = (e.role || '').toLowerCase();
      if (r === 'consultant') c.consultants++;
      else if (r === 'educator') c.educators++;
    }
    return c;
  }, [items]);

  return (
    <div className="bg-bg min-h-screen">
      <div className="container max-w-7xl py-10">
        <div className="flex flex-wrap items-center gap-4 mb-8">
          <Tabs value={state.tab} onValueChange={(v) => setState({ tab: v })}>
            <TabsList>
              <TabsTrigger value="all">{t('experts.tabs.all', 'All')} <span className="ml-1.5 text-xs opacity-70">{counts.all}</span></TabsTrigger>
              <TabsTrigger value="consultants">{t('experts.tabs.consultants', 'Consultants')} <span className="ml-1.5 text-xs opacity-70">{counts.consultants}</span></TabsTrigger>
              <TabsTrigger value="educators">{t('experts.tabs.educators', 'Educators')} <span className="ml-1.5 text-xs opacity-70">{counts.educators}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <Input
              placeholder={t('experts.filters.search_placeholder', 'Search experts…')}
              value={state.q}
              onChange={(e) => setState({ q: e.target.value })}
              className="w-72"
              leadingIcon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>}
            />
            <Select value={state.sort} onChange={(v) => setState({ sort: v })} options={buildSort()} ariaLabel={t('experts.filters.sort_aria', 'Sort')} />
          </div>
        </div>

        {error && (
          <Card className="border-danger/40 bg-danger/10 mb-6">
            <CardContent className="p-4 text-sm">{tf('experts.load_error', "Couldn't load experts: {error}", { error })}</CardContent>
          </Card>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-3"><Skeleton className="w-12 h-12 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/3" /></div></div>
                <SkeletonText lines={3} />
              </CardContent></Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <h3 className="text-xl font-semibold mb-2">{t('experts.empty_title', 'No experts found')}</h3>
              <p className="text-muted mb-4">{t('experts.empty_body_prefix', 'Adjust the filters or apply at')} <a href="/apply/" className="text-brand">/apply</a> {t('experts.empty_body_suffix', 'to be listed.')}</p>
              <Button variant="outline" onClick={() => setState({ q: '', tab: 'all' })}>{t('experts.clear', 'Clear filters')}</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map((e) => <ExpertCard key={e.wallet_address || e.wallet || e.id} e={e} />)}
            </div>
            {shown < filtered.length && (
              <div ref={sentinelRef} className="flex justify-center py-10">
                <Skeleton className="h-3 w-32" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function shortAddr(a) { if (!a) return ''; return a.slice(0, 6) + '…' + a.slice(-4); }

function roleLabel(role) {
  if (!role) return role;
  const r = String(role).toLowerCase();
  const fallback = r[0].toUpperCase() + r.slice(1);
  return t('experts.roles.' + r, fallback);
}

function ExpertCard({ e }) {
  const wallet = e.wallet_address || e.wallet || '';
  const href = '/expert/' + wallet;
  const name = e.display_name || shortAddr(wallet) || t('experts.card.default_name', 'Tokenomic Expert');
  const r30 = Number(e.rate_30 || 0);
  const r60 = Number(e.rate_60 || 0);
  return (
    <a href={href} className="block group focus:outline-none">
      <Card hover className="h-full">
        <CardContent className="p-5 flex flex-col gap-3 h-full">
          <div className="flex items-center gap-3">
            <Avatar src={e.avatar_url} name={name} size="lg" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-fg truncate">{name}</h3>
              <div className="flex items-center gap-2 mt-1">
                {e.role && <Badge variant="brand">{roleLabel(e.role)}</Badge>}
                {e.is_verified && <Badge variant="success">{t('experts.card.verified', 'Verified')}</Badge>}
              </div>
            </div>
          </div>
          {e.specialty && <div className="text-xs text-muted"><strong className="text-fg">{t('experts.card.specialty', 'Specialty:')}</strong> {e.specialty}</div>}
          {e.bio && <p className="text-sm text-muted line-clamp-3 flex-1">{e.bio}</p>}
          <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
            <div className="text-sm font-bold text-success">
              {r30 > 0
                ? tf('experts.card.rate_30', '${rate}/30m', { rate: r30 })
                : r60 > 0
                  ? tf('experts.card.rate_60', '${rate}/60m', { rate: r60 })
                  : <span className="text-muted font-normal">{t('experts.card.rate_request', 'Rate on request')}</span>}
            </div>
            <span className="text-xs text-brand opacity-0 group-hover:opacity-100 transition-opacity">{t('experts.card.view_profile', 'View profile →')}</span>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

mountIsland('ExpertsDirectory', ExpertsDirectory);
export default ExpertsDirectory;
