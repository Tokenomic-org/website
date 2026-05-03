import React, { useEffect, useMemo, useState } from 'react';
import { mountIsland } from '@lib/island.jsx';
import { api, ApiError } from '@lib/api.js';
import { useUrlState } from '@lib/url-state.js';
import { useInfiniteScroll } from '@lib/use-infinite-scroll.js';
import { t, tf, useLocale } from '@lib/i18n.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Select } from '@ui/Select.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Skeleton, SkeletonCard } from '@ui/Skeleton.jsx';
import { Avatar } from '@ui/Avatar.jsx';

const PAGE = 12;

function buildLevels() {
  return [
    { value: '', label: t('communities.filters.all_levels', 'All levels') },
    { value: 'Beginner', label: t('communities.filters.level_beginner', 'Beginner') },
    { value: 'Intermediate', label: t('communities.filters.level_intermediate', 'Intermediate') },
    { value: 'Advanced', label: t('communities.filters.level_advanced', 'Advanced') },
  ];
}
function buildCats() {
  return [
    { value: '', label: t('communities.filters.all_categories', 'All categories') },
    { value: 'Trading', label: t('communities.filters.cat_trading', 'Trading') },
    { value: 'DeFi', label: t('communities.filters.cat_defi', 'DeFi') },
    { value: 'Research', label: t('communities.filters.cat_research', 'Research') },
    { value: 'Compliance', label: t('communities.filters.cat_compliance', 'Compliance') },
  ];
}
function buildSort() {
  return [
    { value: 'members', label: t('communities.filters.sort_members', 'Most members') },
    { value: 'newest', label: t('communities.filters.sort_newest', 'Newest') },
    { value: 'alpha', label: t('communities.filters.sort_alpha', 'A → Z') },
  ];
}

function CommunitiesCatalog() {
  useLocale();
  const [filters, setFilters] = useUrlState({ q: '', level: '', category: '', sort: 'members' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => { setShown(PAGE); }, [filters.q, filters.level, filters.category, filters.sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api('/api/communities')
      .then((r) => { if (alive) setItems(Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])); })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e.message : String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    let out = items.filter((c) => {
      if (filters.level    && (c.level    || '').toLowerCase() !== filters.level.toLowerCase()) return false;
      if (filters.category && (c.category || '').toLowerCase() !== filters.category.toLowerCase()) return false;
      if (q) {
        const hay = `${c.name || c.title || ''} ${c.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    switch (filters.sort) {
      case 'alpha':   out.sort((a, b) => (a.name || a.title || '').localeCompare(b.name || b.title || '')); break;
      case 'newest':  out.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)); break;
      default:        out.sort((a, b) => (b.member_count || b.members || 0) - (a.member_count || a.members || 0));
    }
    return out;
  }, [items, filters]);

  const visible = filtered.slice(0, shown);
  const sentinelRef = useInfiniteScroll(
    () => setShown((s) => Math.min(s + PAGE, filtered.length)),
    { enabled: shown < filtered.length },
  );

  const resultsLabel = filtered.length === 1
    ? tf('communities.filters.results_one', '{count} community', { count: filtered.length })
    : tf('communities.filters.results_other', '{count} communities', { count: filtered.length });

  return (
    <div className="bg-bg min-h-screen">
      <div className="container max-w-7xl py-10">
        <Card className="mb-8 sticky top-4 z-20 backdrop-blur-md bg-surface/85">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder={t('communities.filters.search_placeholder', 'Search communities…')}
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              className="flex-1 min-w-[220px]"
              leadingIcon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>}
            />
            <Select value={filters.level}    onChange={(v) => setFilters({ level: v })}    options={buildLevels()} ariaLabel={t('communities.filters.level_aria', 'Level')} />
            <Select value={filters.category} onChange={(v) => setFilters({ category: v })} options={buildCats()}   ariaLabel={t('communities.filters.category_aria', 'Category')} />
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted hidden sm:inline">{resultsLabel}</span>
              <Select value={filters.sort} onChange={(v) => setFilters({ sort: v })} options={buildSort()} ariaLabel={t('communities.filters.sort_aria', 'Sort')} />
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-danger/40 bg-danger/10 mb-6">
            <CardContent className="p-4 text-sm">{tf('communities.load_error', "Couldn't load communities: {error}", { error })}</CardContent>
          </Card>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <h3 className="text-xl font-semibold mb-2">{t('communities.empty_title', 'No communities match')}</h3>
              <p className="text-muted mb-4">{t('communities.empty_body', 'Adjust the filters or check back soon.')}</p>
              <Button variant="outline" onClick={() => setFilters({ q: '', level: '', category: '' })}>{t('communities.clear', 'Clear filters')}</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map((c) => <CommunityCard key={c.id || c.slug} c={c} />)}
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

function levelLabel(v) {
  if (!v) return v;
  return t('communities.filters.level_' + String(v).toLowerCase(), v);
}
function categoryLabel(v) {
  if (!v) return v;
  return t('communities.filters.cat_' + String(v).toLowerCase(), v);
}

function CommunityCard({ c }) {
  const href = '/community/' + (c.slug || c.id || '');
  const members = Number(c.member_count || c.members || 0);
  return (
    <a href={href} className="block group focus:outline-none">
      <Card hover className="h-full flex flex-col">
        <div className="relative aspect-[16/9] bg-surface2 overflow-hidden">
          {(c.cover_image || c.banner_url) ? (
            <img src={c.cover_image || c.banner_url} alt={c.name || c.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-accent/30 to-brand/30" />
          )}
          {c.is_premium && <div className="absolute top-3 right-3"><Badge variant="brand">{t('communities.card.premium', 'Premium')}</Badge></div>}
        </div>
        <div className="p-5 flex-1 flex flex-col">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {c.level    && <Badge variant="outline">{levelLabel(c.level)}</Badge>}
            {c.category && <Badge>{categoryLabel(c.category)}</Badge>}
          </div>
          <h3 className="font-semibold text-fg leading-snug line-clamp-2 mb-2">{c.name || c.title || t('communities.card.untitled', 'Untitled community')}</h3>
          {c.description && <p className="text-sm text-muted line-clamp-3 mb-4">{c.description}</p>}
          <div className="mt-auto flex items-center justify-between gap-3 text-xs text-muted">
            <div className="flex items-center gap-2">
              <Avatar size="xs" src={c.owner_avatar} name={c.owner_name || c.educator_name || 'T'} />
              <span className="truncate">{c.owner_name || c.educator_name || t('communities.card.default_owner', 'Tokenomic')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              <span>{members.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </Card>
    </a>
  );
}

mountIsland('CommunitiesCatalog', CommunitiesCatalog);
export default CommunitiesCatalog;
