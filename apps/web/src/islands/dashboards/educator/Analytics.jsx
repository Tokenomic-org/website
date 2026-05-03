import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { useToast } from '@ui/Toast.jsx';

/**
 * Educator analytics — enrollments / completion / revenue per course over time.
 * Renders inline SVG sparklines (no Recharts dependency to keep the bundle
 * lean; chart shape mirrors what Recharts would consume).
 */
export default function Analytics() {
  const [courses, setCourses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [data, setData] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api('/api/educator/me/courses', { credentials: 'include' })
      .then((r) => {
        setCourses(r.items || []);
        if (r.items?.length) setActiveId(r.items[0].id);
      })
      .catch((e) => toast.push({ variant: 'danger', title: 'Failed', description: e.message }));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    api(`/api/educator/courses/${activeId}/analytics`, { credentials: 'include' })
      .then(setData).catch((e) => toast.push({ variant: 'danger', title: 'Analytics failed', description: e.message }));
  }, [activeId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Analytics</h2>
        <p className="text-sm text-muted">Enrollments, completion and revenue across the last 90 days.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {courses.map((c) => (
          <button key={c.id} onClick={() => setActiveId(c.id)}
            className={`px-3 h-9 rounded-md text-sm border ${activeId === c.id ? 'bg-brand text-brand-fg border-brand' : 'bg-surface border-border text-fg hover:bg-surface2'}`}>
            {c.title}
          </button>
        ))}
        {!courses.length && <p className="text-muted text-sm">Create a course to see analytics.</p>}
      </div>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Chart title="Enrollments" data={data.enrollments} ykey="n" color="#F7931A" />
          <Chart title="Completions" data={data.completions} ykey="n" color="#10b981" />
          <Chart title="Revenue (USDC)" data={data.revenue} ykey="usdc" color="#3b82f6" />
        </div>
      )}
    </div>
  );
}

function Chart({ title, data, ykey, color }) {
  const arr = (data || []).slice(-30);
  const total = arr.reduce((s, x) => s + Number(x[ykey] || 0), 0);
  const max = Math.max(1, ...arr.map((x) => Number(x[ykey] || 0)));
  const w = 280, h = 60, gap = arr.length > 1 ? w / (arr.length - 1) : 0;
  const points = arr.map((x, i) => `${i * gap},${h - (Number(x[ykey] || 0) / max) * h}`).join(' ');
  return (
    <Card><CardContent>
      <div className="text-xs text-muted">{title} · 30d</div>
      <div className="text-2xl font-bold text-fg">{ykey === 'usdc' ? `$${total.toFixed(2)}` : total}</div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="mt-2">
        {arr.length > 1 && <polyline fill="none" stroke={color} strokeWidth="2" points={points} />}
        {arr.length === 1 && <circle cx={0} cy={h / 2} r={3} fill={color} />}
        {!arr.length && <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="10" fill="#888">no data</text>}
      </svg>
    </CardContent></Card>
  );
}
