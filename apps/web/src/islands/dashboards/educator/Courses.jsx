import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

export default function Courses() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ slug: '', title: '', description: '', price_usdc: 0, level: 'beginner' });
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api('/api/educator/me/courses', { credentials: 'include' });
      setItems(r.items || []);
    } catch (e) { toast.push({ variant: 'danger', title: 'Failed to load', description: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!draft.slug || !draft.title) return;
    setCreating(true);
    try {
      await api('/api/courses', {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ ...draft, status: 'draft' }),
      });
      toast.push({ variant: 'success', title: 'Course created' });
      setOpen(false); setDraft({ slug: '', title: '', description: '', price_usdc: 0, level: 'beginner' });
      load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Create failed', description: e.message }); }
    finally { setCreating(false); }
  };

  const togglePublish = async (course) => {
    const next = course.status === 'active' ? 'draft' : 'active';
    try {
      await api(`/api/courses/${course.id}`, {
        method: 'PATCH', credentials: 'include',
        body: JSON.stringify({ status: next }),
      });
      load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Update failed', description: e.message }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-fg">Courses</h2>
          <p className="text-sm text-muted">Create, edit and publish your educational content.</p>
        </div>
        <Button onClick={() => setOpen(!open)}>{open ? 'Cancel' : '+ New course'}</Button>
      </div>

      {open && (
        <Card>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className="text-xs text-muted">Title</label>
                <Input value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value, slug: draft.slug || slugify(e.target.value) })} />
              </div>
              <div><label className="text-xs text-muted">Slug</label>
                <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} /></div>
              <div><label className="text-xs text-muted">Price (USDC)</label>
                <Input type="number" value={draft.price_usdc} onChange={(e) => setDraft({ ...draft, price_usdc: e.target.value })} /></div>
              <div><label className="text-xs text-muted">Level</label>
                <select className="h-10 px-3 rounded-md border border-border bg-surface w-full text-sm"
                  value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })}>
                  <option>beginner</option><option>intermediate</option><option>advanced</option><option>expert</option>
                </select></div>
            </div>
            <div><label className="text-xs text-muted">Description (markdown supported)</label>
              <textarea rows={4} className="w-full p-3 rounded-md border border-border bg-surface text-sm"
                value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
            <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted">
              <strong className="text-fg">Cover upload &mdash; R2 stub.</strong> Real upload pipeline ships in Phase 6.
            </div>
            <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted">
              <strong className="text-fg">Cloudflare Stream upload &mdash; stub.</strong> Direct Creator Upload widget enabled in Phase 6.
            </div>
            <Button onClick={create} loading={creating}>Create course</Button>
          </CardContent>
        </Card>
      )}

      {loading ? <div className="text-muted text-sm">Loading…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c) => (
            <Card key={c.id} hover>
              <CardContent>
                <div className="flex items-center justify-between mb-2">
                  <Badge variant={c.status === 'active' ? 'brand' : 'outline'}>{c.status}</Badge>
                  <span className="text-xs text-muted">{c.modules_count || 0} modules</span>
                </div>
                <h3 className="text-base font-semibold text-fg mb-1 line-clamp-1">{c.title}</h3>
                <p className="text-xs text-muted line-clamp-2 min-h-[2.4em]">{c.description || 'No description'}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm font-semibold text-success">
                    {Number(c.price_usdc) > 0 ? `$${c.price_usdc} USDC` : 'Free'}
                  </span>
                  <span className="text-xs text-muted">{c.enrolled_count || 0} enrolled</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" className="flex-1"
                    onClick={() => (window.location.href = `/dashboard/educator/lessons/?course=${c.id}`)}>
                    Lessons
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => togglePublish(c)}>
                    {c.status === 'active' ? 'Unpublish' : 'Publish'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!items.length && (
            <Card><CardContent>
              <p className="text-muted text-sm text-center py-8">
                No courses yet. Click <strong>+ New course</strong> to begin.
              </p>
            </CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
