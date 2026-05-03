import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { useToast } from '@ui/Toast.jsx';

/**
 * Per-course nested lesson editor with drag-drop reorder.
 * Course id is read from `?course=<id>` (set by the Courses card link).
 */
export default function Lessons() {
  const courseId = useCourseId();
  const [course, setCourse] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ title: '', body_md: '', duration_minutes: 5 });
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState(null);
  const toast = useToast();

  const load = async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      const [c, m] = await Promise.all([
        api(`/api/courses/${courseId}`),
        api(`/api/courses/${courseId}/modules`),
      ]);
      setCourse(c); setItems(m.items || []);
    } catch (e) { toast.push({ variant: 'danger', title: 'Failed to load', description: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [courseId]);

  const addModule = async () => {
    if (!draft.title) return;
    setBusy(true);
    try {
      await api(`/api/courses/${courseId}/modules`, {
        method: 'POST', credentials: 'include',
        body: JSON.stringify(draft),
      });
      setDraft({ title: '', body_md: '', duration_minutes: 5 });
      load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Add failed', description: e.message }); }
    finally { setBusy(false); }
  };

  const remove = async (mid) => {
    if (!confirm('Delete this lesson?')) return;
    try {
      await api(`/api/modules/${mid}`, { method: 'DELETE', credentials: 'include' });
      load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Delete failed', description: e.message }); }
  };

  const onDrop = async (targetId) => {
    if (!dragId || dragId === targetId) return;
    const order = items.map((m) => m.id);
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    order.splice(to, 0, ...order.splice(from, 1));
    setItems(order.map((id) => items.find((m) => m.id === id)));
    setDragId(null);
    try {
      await api(`/api/courses/${courseId}/modules/reorder`, {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ order }),
      });
    } catch (e) { toast.push({ variant: 'danger', title: 'Reorder failed', description: e.message }); load(); }
  };

  if (!courseId) {
    return (
      <Card><CardContent>
        <p className="text-muted text-sm">No course selected. Pick a course from the <a className="text-brand underline" href="/dashboard/educator/">Courses</a> page.</p>
      </CardContent></Card>
    );
  }
  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Lessons</h2>
        <p className="text-sm text-muted">{course?.title || 'Untitled course'} — drag to reorder.</p>
      </div>

      <Card><CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input placeholder="Lesson title" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="md:col-span-2" />
          <Input placeholder="Duration (min)" type="number" value={draft.duration_minutes}
            onChange={(e) => setDraft({ ...draft, duration_minutes: e.target.value })} />
        </div>
        <textarea rows={3} placeholder="Markdown body…"
          className="w-full p-3 rounded-md border border-border bg-surface text-sm"
          value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} />
        <div className="flex justify-end">
          <Button onClick={addModule} loading={busy}>+ Add lesson</Button>
        </div>
      </CardContent></Card>

      <div className="space-y-2">
        {items.map((m, i) => (
          <div key={m.id}
               draggable onDragStart={() => setDragId(m.id)} onDragOver={(e) => e.preventDefault()}
               onDrop={() => onDrop(m.id)}
               className="flex items-center gap-3 p-3 bg-surface border border-border rounded-md cursor-move">
            <span className="w-8 h-8 rounded-md bg-brand text-brand-fg flex items-center justify-center font-semibold text-sm">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-fg truncate">{m.title}</div>
              <div className="text-xs text-muted">{m.duration_minutes || 0} min</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => remove(m.id)}>✕</Button>
          </div>
        ))}
        {!items.length && (
          <Card><CardContent>
            <p className="text-muted text-sm text-center py-6">No lessons yet — add the first above. Quizzes &amp; assignments are stubs in this phase.</p>
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

function useCourseId() {
  const [id, setId] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const v = url.searchParams.get('course');
    if (v && /^\d+$/.test(v)) setId(Number(v));
  }, []);
  return id;
}
