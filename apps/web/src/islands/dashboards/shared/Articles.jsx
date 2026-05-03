import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

/**
 * Markdown article editor — paywall toggle, scheduled publish.
 * Uses a plain <textarea> + cdn-loaded `marked` for the live preview, mirroring
 * the legacy Alpine page. Future drop-in replacement: CodeMirror @ Phase 5.
 */
export default function Articles() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({ slug: '', title: '', excerpt: '', body: '', paywalled: false, scheduled_publish_at: '' });
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const r = await api('/api/educator/me/articles', { credentials: 'include' });
      setItems(r.items || []);
    } catch (e) { toast.push({ variant: 'danger', title: 'Failed', description: e.message }); }
  };
  useEffect(() => { load(); }, []);

  const save = async (publishNow) => {
    setBusy(true);
    try {
      const payload = {
        ...draft,
        slug: draft.slug || slugify(draft.title),
        status: publishNow ? 'published' : (draft.scheduled_publish_at ? 'scheduled' : 'draft'),
      };
      if (editingId) await api(`/api/educator/articles/${editingId}`, { method: 'PATCH', credentials: 'include', body: JSON.stringify(payload) });
      else await api('/api/educator/articles', { method: 'POST', credentials: 'include', body: JSON.stringify(payload) });
      toast.push({ variant: 'success', title: publishNow ? 'Article published' : 'Article saved' });
      reset(); load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Save failed', description: e.message }); }
    finally { setBusy(false); }
  };

  const reset = () => {
    setDraft({ slug: '', title: '', excerpt: '', body: '', paywalled: false, scheduled_publish_at: '' });
    setEditingId(null); setShowEditor(false);
  };

  const edit = async (a) => {
    try {
      const full = await api(`/api/articles/${a.slug}`);
      setDraft({
        slug: full.slug, title: full.title, excerpt: full.excerpt || '', body: full.body || '',
        paywalled: !!full.paywalled, scheduled_publish_at: full.scheduled_publish_at || '',
      });
      setEditingId(a.id); setShowEditor(true);
    } catch (e) { toast.push({ variant: 'danger', title: 'Load failed', description: e.message }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-fg">Articles</h2>
          <p className="text-sm text-muted">Markdown editor with paywall + scheduled publishing.</p>
        </div>
        <Button onClick={() => { reset(); setShowEditor(true); }}>+ New article</Button>
      </div>

      {showEditor && (
        <Card><CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Input placeholder="Slug (auto)" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
          </div>
          <Input placeholder="Excerpt" value={draft.excerpt} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} />
          <textarea rows={12} placeholder="Markdown body…"
            className="w-full p-3 rounded-md border border-border bg-surface text-sm font-mono"
            value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.paywalled} onChange={(e) => setDraft({ ...draft, paywalled: e.target.checked })} />
              Members-only (paywalled)
            </label>
            <div>
              <label className="text-xs text-muted block mb-1">Scheduled publish (optional)</label>
              <input type="datetime-local" className="h-10 px-3 rounded-md border border-border bg-surface w-full text-sm"
                value={draft.scheduled_publish_at}
                onChange={(e) => setDraft({ ...draft, scheduled_publish_at: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button variant="secondary" onClick={() => save(false)} loading={busy}>Save draft</Button>
            <Button onClick={() => save(true)} loading={busy}>Publish now</Button>
          </div>
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {items.map((a) => (
          <Card key={a.id}><CardContent className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-fg truncate">{a.title}</h3>
                <Badge variant={a.status === 'published' ? 'success' : a.status === 'scheduled' ? 'accent' : 'outline'}>{a.status}</Badge>
                {a.paywalled ? <Badge variant="brand">Members</Badge> : null}
              </div>
              <p className="text-xs text-muted line-clamp-1">{a.excerpt}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => edit(a)}>Edit</Button>
          </CardContent></Card>
        ))}
        {!items.length && <p className="text-sm text-muted text-center py-6">No articles yet.</p>}
      </div>
    </div>
  );
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
