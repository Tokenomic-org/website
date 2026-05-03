import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

export default function Services() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [draft, setDraft] = useState({ title: '', description: '', duration_min: 30, price_usdc: 50, status: 'active' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api('/api/consultant/me/services', { credentials: 'include' });
      setItems(r.items || []);
    } catch (e) { toast.push({ variant: 'danger', title: 'Failed', description: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const startNew = () => { setDraft({ title: '', description: '', duration_min: 30, price_usdc: 50, status: 'active' }); setEditing('new'); };
  const startEdit = (s) => { setDraft(s); setEditing(s.id); };

  const save = async () => {
    setBusy(true);
    try {
      if (editing === 'new') {
        await api('/api/consultant/services', { method: 'POST', credentials: 'include', body: JSON.stringify(draft) });
      } else {
        await api(`/api/consultant/services/${editing}`, { method: 'PATCH', credentials: 'include', body: JSON.stringify(draft) });
      }
      setEditing(null); load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Save failed', description: e.message }); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this service?')) return;
    try { await api(`/api/consultant/services/${id}`, { method: 'DELETE', credentials: 'include' }); load(); }
    catch (e) { toast.push({ variant: 'danger', title: 'Delete failed', description: e.message }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-fg">Services</h2>
          <p className="text-sm text-muted">Define the offerings that learners can book on-chain.</p>
        </div>
        <Button onClick={startNew}>+ New service</Button>
      </div>

      {editing && (
        <Card><CardContent className="space-y-3">
          <h3 className="text-sm font-semibold">{editing === 'new' ? 'Create service' : 'Edit service'}</h3>
          <Input placeholder="Title (e.g. 30-min strategy review)" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea rows={3} placeholder="What's included?"
            className="w-full p-3 rounded-md border border-border bg-surface text-sm"
            value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-muted">Duration (min)</label>
              <Input type="number" value={draft.duration_min}
                onChange={(e) => setDraft({ ...draft, duration_min: Number(e.target.value) })} /></div>
            <div><label className="text-xs text-muted">Price (USDC)</label>
              <Input type="number" value={draft.price_usdc}
                onChange={(e) => setDraft({ ...draft, price_usdc: Number(e.target.value) })} /></div>
            <div><label className="text-xs text-muted">Status</label>
              <select className="h-10 px-3 rounded-md border border-border bg-surface w-full text-sm"
                value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option>active</option><option>draft</option><option>archived</option>
              </select></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} loading={busy}>Save</Button>
          </div>
        </CardContent></Card>
      )}

      {loading ? <div className="text-muted text-sm">Loading…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((s) => (
            <Card key={s.id} hover><CardContent>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-fg">{s.title}</h3>
                <Badge variant={s.status === 'active' ? 'brand' : 'outline'}>{s.status}</Badge>
              </div>
              <p className="text-sm text-muted line-clamp-2 mb-3">{s.description || 'No description'}</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{s.duration_min} min</span>
                <span className="font-semibold text-success">${Number(s.price_usdc).toFixed(0)} USDC</span>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => startEdit(s)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>Delete</Button>
              </div>
            </CardContent></Card>
          ))}
          {!items.length && (
            <Card><CardContent>
              <p className="text-muted text-sm text-center py-6">No services yet — create your first offering.</p>
            </CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}
