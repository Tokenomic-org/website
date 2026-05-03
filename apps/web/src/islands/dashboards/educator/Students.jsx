import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

export default function Students() {
  const [courses, setCourses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api('/api/educator/me/courses', { credentials: 'include' })
      .then((r) => {
        setCourses(r.items || []);
        if (r.items?.length) setActiveId(r.items[0].id);
      })
      .catch((e) => toast.push({ variant: 'danger', title: 'Failed', description: e.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    api(`/api/educator/courses/${activeId}/students`, { credentials: 'include' })
      .then(setData).catch((e) => toast.push({ variant: 'danger', title: 'Roster failed', description: e.message }));
  }, [activeId]);

  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Students</h2>
        <p className="text-sm text-muted">Roster and progress for each of your courses.</p>
      </div>

      {!courses.length ? (
        <Card><CardContent><p className="text-muted text-sm">Create a course first to see enrolled students.</p></CardContent></Card>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {courses.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              className={`px-3 h-9 rounded-md text-sm border ${activeId === c.id ? 'bg-brand text-brand-fg border-brand' : 'bg-surface border-border text-fg hover:bg-surface2'}`}>
              {c.title}
            </button>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Enrolled" value={data.total} />
            <Stat label="Completed" value={data.completed} />
            <Stat label="Avg progress" value={`${data.avg_progress}%`} />
          </div>
          <Card><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-muted">
                <th className="p-3">Student</th><th className="p-3">Wallet</th>
                <th className="p-3">Progress</th><th className="p-3">Enrolled</th><th className="p-3">Last seen</th>
              </tr></thead>
              <tbody>
                {(data.items || []).map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium">{s.student_name || '—'}</td>
                    <td className="p-3 font-mono text-xs text-muted">{shortAddr(s.student_wallet)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-surface2 rounded">
                          <div className="h-full bg-brand rounded" style={{ width: `${s.progress || 0}%` }} />
                        </div>
                        <span className="text-xs">{s.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted">{(s.enrolled_at || '').slice(0, 10)}</td>
                    <td className="p-3">
                      {(s.progress || 0) >= 100
                        ? <Badge variant="success">Complete</Badge>
                        : <span className="text-xs text-muted">{(s.last_seen_at || '').slice(0, 10) || '—'}</span>}
                    </td>
                  </tr>
                ))}
                {!(data.items || []).length && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted text-sm">No enrollments yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent></Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return <Card><CardContent>
    <div className="text-2xl font-bold text-fg">{value}</div>
    <div className="text-xs text-muted">{label}</div>
  </CardContent></Card>;
}
function shortAddr(a) { if (!a) return '—'; return a.slice(0, 6) + '…' + a.slice(-4); }
