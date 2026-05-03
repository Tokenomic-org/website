import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { useToast } from '@ui/Toast.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Availability — Phase 4 stub: lets the consultant define a recurring weekly
 * window per day. The real Google/Microsoft/Calendly OAuth + free/busy merge
 * lands in Phase 4. This editor persists to D1 so we have data to render.
 */
export default function Availability() {
  const [slots, setSlots] = useState([]); // [{ weekday, start_min, end_min }]
  const [tz, setTz] = useState('UTC');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api('/api/consultant/me/availability', { credentials: 'include' })
      .then((r) => setSlots(r.items || []))
      .catch((e) => toast.push({ variant: 'danger', title: 'Failed', description: e.message }));
  }, []);

  const update = (i, key, value) => {
    const copy = [...slots]; copy[i] = { ...copy[i], [key]: value }; setSlots(copy);
  };
  const remove = (i) => setSlots(slots.filter((_, j) => j !== i));
  const add = () => setSlots([...slots, { weekday: 1, start_min: 540, end_min: 1020 }]);

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/consultant/me/availability', {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ slots: slots.map((s) => ({
          weekday: Number(s.weekday), start_min: Number(s.start_min), end_min: Number(s.end_min),
        })), timezone: tz }),
      });
      toast.push({ variant: 'success', title: 'Availability saved' });
    } catch (e) { toast.push({ variant: 'danger', title: 'Save failed', description: e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Availability</h2>
        <p className="text-sm text-muted">Set the weekly window when learners can book a session.</p>
      </div>

      <Card><CardContent className="space-y-3">
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted">
          <strong className="text-fg">Calendar sync (Google / Microsoft / Calendly)</strong> ships in Phase 4.
          For now, define a recurring weekly schedule below.
        </div>
        {slots.map((s, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <select className="h-9 px-2 rounded-md border border-border bg-surface text-sm"
              value={s.weekday} onChange={(e) => update(i, 'weekday', Number(e.target.value))}>
              {DAYS.map((d, idx) => <option key={d} value={idx}>{d}</option>)}
            </select>
            <input type="time" className="h-9 px-2 rounded-md border border-border bg-surface text-sm"
              value={minToHM(s.start_min)} onChange={(e) => update(i, 'start_min', hmToMin(e.target.value))} />
            <span className="text-muted text-sm">→</span>
            <input type="time" className="h-9 px-2 rounded-md border border-border bg-surface text-sm"
              value={minToHM(s.end_min)} onChange={(e) => update(i, 'end_min', hmToMin(e.target.value))} />
            <Button size="sm" variant="ghost" onClick={() => remove(i)}>✕</Button>
          </div>
        ))}
        {!slots.length && <p className="text-sm text-muted">No availability set.</p>}
        <div className="flex justify-between items-center">
          <Button variant="outline" size="sm" onClick={add}>+ Add window</Button>
          <Button onClick={save} loading={busy}>Save</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}

function minToHM(m) {
  const h = String(Math.floor((m || 0) / 60)).padStart(2, '0');
  const mm = String((m || 0) % 60).padStart(2, '0');
  return `${h}:${mm}`;
}
function hmToMin(s) {
  const [h, m] = (s || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
