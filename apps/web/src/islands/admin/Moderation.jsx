/**
 * Moderation — list/search courses, articles, communities and toggle a
 * `status='hidden'` soft-delete via D1. Restoring sets status back to
 * 'published' (articles) or 'active' (courses, communities).
 */

import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@ui/Tabs.jsx';
import { useToast } from '@ui/Toast.jsx';

const TABS = [
  { id: 'courses',     label: 'Courses' },
  { id: 'articles',    label: 'Articles' },
  { id: 'communities', label: 'Communities' },
];

export default function Moderation() {
  const [type, setType] = useState('courses');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const toast = useToast();

  const load = async (t = type, term = q) => {
    setLoading(true);
    try {
      const u = `/admin/moderation?type=${encodeURIComponent(t)}` + (term ? `&q=${encodeURIComponent(term)}` : '');
      const r = await api(u, { credentials: 'include' });
      setItems(r.items || []);
    } catch (e) { toast.error('Load failed: ' + e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(type, ''); /* on tab change */ }, [type]); // eslint-disable-line

  const toggle = async (row, op) => {
    setBusy((b) => ({ ...b, [row.id]: op }));
    try {
      await api(`/admin/moderation/${type}/${row.id}/${op}`, { method: 'POST', credentials: 'include' });
      toast.success(op === 'hide' ? 'Hidden' : 'Restored');
      load(type, q);
    } catch (e) { toast.error(e.message); }
    finally { setBusy((b) => { const n = { ...b }; delete n[row.id]; return n; }); }
  };

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Moderation</h1>
        <p className="text-sm text-muted">
          Soft-delete content via a status flag. Hidden items disappear from public feeds but
          remain queryable for restoration.
        </p>
      </header>

      <Tabs value={type} onValueChange={setType}>
        <TabsList>
          {TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.id} value={t.id} className="space-y-3">
            <form
              onSubmit={(e) => { e.preventDefault(); load(t.id, q.trim()); }}
              className="flex gap-2"
            >
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${t.label.toLowerCase()} by title, slug, or owner…`}
                className="flex-1"
              />
              <Button type="submit">Search</Button>
            </form>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface2 text-muted text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-3">Title</th>
                      <th className="text-left px-4 py-3">Slug</th>
                      <th className="text-left px-4 py-3">Owner</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Loading…</td></tr>}
                    {!loading && items.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No items.</td></tr>
                    )}
                    {items.map((r) => {
                      const hidden = r.status === 'hidden';
                      const op = hidden ? 'unhide' : 'hide';
                      return (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-4 py-3 max-w-xs truncate">{r.title}</td>
                          <td className="px-4 py-3 font-mono text-xs">{r.slug}</td>
                          <td className="px-4 py-3 font-mono text-xs">{r.owner ? `${r.owner.slice(0, 6)}…${r.owner.slice(-4)}` : '—'}</td>
                          <td className="px-4 py-3"><Badge variant={hidden ? 'danger' : 'success'}>{r.status}</Badge></td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant={hidden ? 'outline' : 'danger'}
                              loading={busy[r.id] === op}
                              onClick={() => toggle(r, op)}
                            >
                              {hidden ? 'Restore' : 'Hide'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
