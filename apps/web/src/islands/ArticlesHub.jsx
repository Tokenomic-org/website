import React, { useEffect, useMemo, useState } from 'react';
import { mountIsland } from '@lib/island.jsx';
import { api, ApiError } from '@lib/api.js';
import { useUrlState } from '@lib/url-state.js';
import { useInfiniteScroll } from '@lib/use-infinite-scroll.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Tabs, TabsList, TabsTrigger } from '@ui/Tabs.jsx';
import { Avatar } from '@ui/Avatar.jsx';
import { Badge } from '@ui/Badge.jsx';
import { SkeletonCard, Skeleton } from '@ui/Skeleton.jsx';

const CATEGORIES = ['all', 'Strategy', 'Technical', 'Market'];
const PAGE = 12;

function ArticlesHub() {
  const [state, setState] = useUrlState({ cat: 'all', q: '' });
  const [articles, setArticles] = useState([]);
  const [authors, setAuthors]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [shown, setShown]       = useState(PAGE);

  useEffect(() => { setShown(PAGE); }, [state.cat, state.q]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    Promise.all([
      api('/api/articles').then((r) => Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])).catch((e) => { throw e; }),
      api('/api/experts').then((r) => Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])).catch(() => []),
    ])
      .then(([arts, exps]) => {
        if (!alive) return;
        setArticles(arts || []);
        setAuthors((exps || []).filter((e) => (e.role || '').toLowerCase() === 'educator').slice(0, 8));
      })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e.message : String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = state.q.trim().toLowerCase();
    return articles.filter((a) => {
      if (state.cat !== 'all' && (a.category || '').toLowerCase() !== state.cat.toLowerCase()) return false;
      if (q) {
        const hay = `${a.title || ''} ${a.excerpt || ''} ${a.author_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [articles, state]);

  const visible = filtered.slice(0, shown);
  const sentinelRef = useInfiniteScroll(
    () => setShown((s) => Math.min(s + PAGE, filtered.length)),
    { enabled: shown < filtered.length },
  );

  const grouped = useMemo(() => {
    const out = {};
    for (const a of visible) {
      const k = a.category || 'Other';
      (out[k] ||= []).push(a);
    }
    return out;
  }, [visible]);

  const featured = visible.slice(0, 3);

  return (
    <div className="bg-bg min-h-screen">
      <div className="container max-w-7xl py-10">
        <div className="flex flex-wrap items-center gap-4 mb-8">
          <Tabs value={state.cat} onValueChange={(v) => setState({ cat: v })}>
            <TabsList>
              {CATEGORIES.map((c) => (
                <TabsTrigger key={c} value={c}>{c === 'all' ? 'All' : c}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="ml-auto">
            <Input
              placeholder="Search articles…"
              value={state.q}
              onChange={(e) => setState({ q: e.target.value })}
              className="w-72"
              leadingIcon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>}
            />
          </div>
        </div>

        {error && (
          <Card className="border-danger/40 bg-danger/10 mb-6">
            <CardContent className="p-4 text-sm">Couldn't load articles: {error}</CardContent>
          </Card>
        )}

        {loading ? (
          <div className="space-y-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <Card className="text-center py-16"><CardContent>
            <h3 className="text-xl font-semibold mb-2">No articles match</h3>
            <p className="text-muted mb-4">Try a different category or clear the search.</p>
            <Button variant="outline" onClick={() => setState({ q: '', cat: 'all' })}>Clear filters</Button>
          </CardContent></Card>
        ) : (
          <>
            {state.cat === 'all' && featured.length > 0 && (
              <section className="mb-12">
                <SectionTitle title="Featured" />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {featured.map((a, idx) => <ArticleCard key={a.slug} article={a} hero={idx === 0} />)}
                </div>
              </section>
            )}

            {Object.keys(grouped).map((cat) => (
              <section key={cat} className="mb-12">
                <SectionTitle title={cat} />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {grouped[cat].map((a) => <ArticleCard key={a.slug} article={a} />)}
                </div>
              </section>
            ))}

            {shown < filtered.length && (
              <div ref={sentinelRef} className="flex justify-center py-10">
                <Skeleton className="h-3 w-32" />
              </div>
            )}

            {authors.length > 0 && <AuthorsStrip authors={authors} />}

            <Card className="mt-10 bg-gradient-to-br from-brand/15 to-accent/15 border-brand/30 text-center">
              <CardContent className="p-10">
                <h3 className="text-2xl font-bold mb-2 text-fg">Share your DeFi expertise</h3>
                <p className="text-muted mb-5 max-w-xl mx-auto">Educators and consultants can publish to the Tokenomic feed straight from their dashboard.</p>
                <Button onClick={() => (window.location.href = '/dashboard-articles/')}>Go to article studio</Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title }) {
  return (
    <div className="flex items-center justify-between mb-5 pb-3 border-b border-border">
      <h2 className="text-xl font-bold text-fg">{title}</h2>
    </div>
  );
}

function ArticleCard({ article, hero = false }) {
  const href = '/articles/' + article.slug;
  const date = article.published_at ? formatDate(article.published_at) : '';
  return (
    <a href={href} className={`block group focus:outline-none ${hero ? 'lg:col-span-2 lg:row-span-1' : ''}`}>
      <Card hover className="h-full overflow-hidden">
        <div className={`relative overflow-hidden bg-surface2 ${hero ? 'aspect-[16/8]' : 'aspect-[16/10]'}`}>
          {article.image_url ? (
            <img src={article.image_url} alt={article.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-brand/20 to-accent/30" />
          )}
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wide text-muted">
            {article.category && <Badge>{article.category}</Badge>}
            {date && <span>{date}</span>}
            {article.reading_time ? <span>· {article.reading_time}m read</span> : null}
          </div>
          <h3 className={`font-semibold text-fg leading-snug line-clamp-2 mb-2 ${hero ? 'text-xl' : 'text-base'}`}>
            {article.title}
          </h3>
          {article.excerpt && <p className="text-sm text-muted line-clamp-2 mb-3">{article.excerpt}</p>}
          <div className="flex items-center gap-2 text-xs text-muted">
            <Avatar size="xs" src={article.author_avatar} name={article.author_name || 'T'} />
            <span>{article.author_name || 'Tokenomic Team'}</span>
          </div>
        </div>
      </Card>
    </a>
  );
}

function AuthorsStrip({ authors }) {
  return (
    <Card className="mb-10">
      <CardContent className="p-6 flex items-center justify-between flex-wrap gap-4">
        <h3 className="text-lg font-semibold text-fg">Meet our authors</h3>
        <div className="flex items-center">
          <div className="flex -space-x-2">
            {authors.map((a) => (
              <Avatar key={a.wallet_address || a.id} src={a.avatar_url} name={a.display_name} className="ring-2 ring-surface" />
            ))}
          </div>
          <a href="/experts/" className="ml-4 text-sm text-brand font-semibold hover:underline">View all →</a>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(s) {
  try {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

mountIsland('ArticlesHub', ArticlesHub);
export default ArticlesHub;
