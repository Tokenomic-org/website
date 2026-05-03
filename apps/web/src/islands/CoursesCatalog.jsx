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
    { value: '', label: t('courses.filters.all_levels', 'All levels') },
    { value: 'Beginner', label: t('courses.filters.level_beginner', 'Beginner') },
    { value: 'Intermediate', label: t('courses.filters.level_intermediate', 'Intermediate') },
    { value: 'Advanced', label: t('courses.filters.level_advanced', 'Advanced') },
  ];
}
function buildAssets() {
  return [
    { value: '', label: t('courses.filters.all_assets', 'All asset classes') },
    { value: 'DeFi', label: t('courses.filters.asset_defi', 'DeFi') },
    { value: 'Stablecoins', label: t('courses.filters.asset_stablecoins', 'Stablecoins') },
    { value: 'Trading', label: t('courses.filters.asset_trading', 'Trading') },
    { value: 'Compliance', label: t('courses.filters.asset_compliance', 'Compliance') },
  ];
}
function buildSort() {
  return [
    { value: 'newest', label: t('courses.filters.sort_newest', 'Newest') },
    { value: 'price-asc', label: t('courses.filters.sort_price_asc', 'Price ↑') },
    { value: 'price-desc', label: t('courses.filters.sort_price_desc', 'Price ↓') },
    { value: 'duration', label: t('courses.filters.sort_duration', 'Shortest') },
  ];
}

function CoursesCatalog() {
  useLocale();
  const [filters, setFilters] = useUrlState({
    q: '',
    level: '',
    asset: '',
    maxPrice: '',
    cert: false,
    sort: 'newest',
  });

  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api('/api/courses')
      .then((r) => { if (alive) setAll(Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])); })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e.message : String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { setShown(PAGE); }, [filters.q, filters.level, filters.asset, filters.maxPrice, filters.cert, filters.sort]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const lvl = filters.level;
    const ast = filters.asset;
    const max = Number(filters.maxPrice) || 0;
    let out = all.filter((c) => {
      if (lvl && (c.level || '').toLowerCase() !== lvl.toLowerCase()) return false;
      if (ast && (c.category || c.asset_class || '').toLowerCase() !== ast.toLowerCase()) return false;
      if (max > 0 && Number(c.price_usdc || c.price || 0) > max) return false;
      if (filters.cert && !(c.has_certificate || c.certificate_enabled)) return false;
      if (q) {
        const hay = `${c.title || ''} ${c.description || ''} ${c.educator_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    switch (filters.sort) {
      case 'price-asc':  out.sort((a, b) => (a.price_usdc || 0) - (b.price_usdc || 0)); break;
      case 'price-desc': out.sort((a, b) => (b.price_usdc || 0) - (a.price_usdc || 0)); break;
      case 'duration':   out.sort((a, b) => (a.duration_min || a.duration || 0) - (b.duration_min || b.duration || 0)); break;
      default:           out.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return out;
  }, [all, filters]);

  const visible = filtered.slice(0, shown);
  const sentinelRef = useInfiniteScroll(
    () => setShown((s) => Math.min(s + PAGE, filtered.length)),
    { enabled: shown < filtered.length },
  );

  const resultsLabel = filtered.length === 1
    ? tf('courses.filters.results_one', '{count} result', { count: filtered.length })
    : tf('courses.filters.results_other', '{count} results', { count: filtered.length });

  return (
    <div className="bg-bg min-h-screen">
      <div className="container max-w-7xl py-10">
        {/* Filter bar */}
        <Card className="mb-8 sticky top-4 z-20 backdrop-blur-md bg-surface/85">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder={t('courses.filters.search_placeholder', 'Search courses, educators…')}
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              className="flex-1 min-w-[220px]"
              leadingIcon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              }
            />
            <Select value={filters.level} onChange={(v) => setFilters({ level: v })} options={buildLevels()} ariaLabel={t('courses.filters.level_aria', 'Level')} />
            <Select value={filters.asset} onChange={(v) => setFilters({ asset: v })} options={buildAssets()} ariaLabel={t('courses.filters.asset_aria', 'Asset class')} />
            <Input
              placeholder={t('courses.filters.max_price', 'Max price (USDC)')}
              type="number"
              value={filters.maxPrice}
              onChange={(e) => setFilters({ maxPrice: e.target.value })}
              className="w-44"
            />
            <label className="inline-flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!filters.cert}
                onChange={(e) => setFilters({ cert: e.target.checked })}
                className="accent-brand"
              />
              {t('courses.filters.certificate', 'Certificate')}
            </label>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted hidden sm:inline">{resultsLabel}</span>
              <Select value={filters.sort} onChange={(v) => setFilters({ sort: v })} options={buildSort()} ariaLabel={t('courses.filters.sort_aria', 'Sort')} />
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-danger/40 bg-danger/10 mb-6">
            <CardContent className="p-4 text-sm text-fg">{tf('courses.load_error', "Couldn't load courses: {error}", { error })}</CardContent>
          </Card>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <h3 className="text-xl font-semibold mb-2">{t('courses.empty_title', 'No courses match those filters')}</h3>
              <p className="text-muted mb-4">{t('courses.empty_body', 'Try clearing a filter or broadening your search.')}</p>
              <Button variant="outline" onClick={() => setFilters({ q: '', level: '', asset: '', maxPrice: '', cert: false })}>{t('courses.clear', 'Clear filters')}</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map((c) => <CourseCard key={c.id || c.slug} c={c} />)}
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
  const key = 'courses.filters.level_' + String(v).toLowerCase();
  return t(key, v);
}
function assetLabel(v) {
  if (!v) return v;
  const key = 'courses.filters.asset_' + String(v).toLowerCase();
  return t(key, v);
}

function CourseCard({ c }) {
  const slug = c.slug || c.id;
  const href = '/courses/' + (c.slug || c.id || '');
  const price = Number(c.price_usdc || c.price || 0);
  const dur   = Number(c.duration_min || c.duration || 0);
  return (
    <a href={href} className="block group focus:outline-none">
      <Card hover className="h-full flex flex-col">
        <div className="relative aspect-[16/10] bg-surface2 overflow-hidden">
          {c.cover_image || c.image_url ? (
            <img src={c.cover_image || c.image_url} alt={c.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-brand/30 to-accent/30" />
          )}
          {c.has_certificate && (
            <div className="absolute top-3 right-3"><Badge variant="brand">{t('courses.card.cert_badge', 'Cert')}</Badge></div>
          )}
        </div>
        <div className="p-5 flex-1 flex flex-col">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {c.level && <Badge variant="outline">{levelLabel(c.level)}</Badge>}
            {(c.category || c.asset_class) && <Badge>{assetLabel(c.category || c.asset_class)}</Badge>}
          </div>
          <h3 className="font-semibold text-fg leading-snug line-clamp-2 mb-2">{c.title || t('courses.card.untitled', 'Untitled course')}</h3>
          {c.description && <p className="text-sm text-muted line-clamp-2 mb-4">{c.description}</p>}
          <div className="mt-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar size="sm" src={c.educator_avatar} name={c.educator_name || 'T'} />
              <span className="text-xs text-muted truncate">{c.educator_name || t('courses.card.default_author', 'Tokenomic Team')}</span>
            </div>
            <div className="text-right shrink-0">
              <div className="text-base font-bold text-fg">{price > 0 ? `$${price}` : t('courses.card.free', 'Free')}</div>
              {dur > 0 && <div className="text-[11px] text-muted">{dur >= 60 ? tf('courses.card.duration_hours', '{n}h', { n: Math.round(dur / 60) }) : tf('courses.card.duration_minutes', '{n}m', { n: dur })}</div>}
            </div>
          </div>
        </div>
      </Card>
    </a>
  );
}

mountIsland('CoursesCatalog', CoursesCatalog);
export default CoursesCatalog;
