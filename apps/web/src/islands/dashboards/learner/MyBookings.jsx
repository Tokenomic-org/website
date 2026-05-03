import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Button } from '@ui/Button.jsx';

const ESCROW_VARIANTS = {
  none: 'outline', held: 'accent', released: 'success', disputed: 'danger', refunded: 'outline',
};

export default function MyBookings() {
  const [data, setData] = useState({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/me/bookings', { credentials: 'include' })
      .then((r) => setData({ upcoming: r.upcoming || [], past: r.past || [] }))
      .catch(() => setData({ upcoming: [], past: [] }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted text-sm">Loading bookings…</div>;

  const empty = data.upcoming.length === 0 && data.past.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Bookings</h2>
        <p className="text-sm text-muted">Sessions with experts and consultants, with on-chain escrow status.</p>
      </div>

      {empty ? (
        <Card><CardContent className="py-10 text-center">
          <p className="text-muted mb-3">No bookings yet.</p>
          <Button onClick={() => (window.location.href = '/experts/')}>Find an expert</Button>
        </CardContent></Card>
      ) : (
        <>
          <Section title="Upcoming" rows={data.upcoming} emptyText="Nothing on the calendar." />
          <Section title="Past"     rows={data.past}     emptyText="No past sessions." />
        </>
      )}
    </div>
  );
}

function Section({ title, rows, emptyText }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 pt-4 pb-2 font-semibold">{title}</div>
        {rows.length === 0 ? (
          <div className="px-4 pb-4 text-sm text-muted">{emptyText}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-y border-border text-left text-muted">
                <th className="p-3">Session</th>
                <th className="p-3">With</th>
                <th className="p-3">When</th>
                <th className="p-3">Price</th>
                <th className="p-3">Escrow</th>
                <th className="p-3"></th>
              </tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="p-3">{b.service_title || b.topic || 'Session'}</td>
                    <td className="p-3">
                      <div className="font-medium">{b.consultant_name || '—'}</div>
                      <div className="font-mono text-xs text-muted">{(b.consultant_wallet || '').slice(0, 10)}…</div>
                    </td>
                    <td className="p-3 text-xs text-muted">{b.booking_date} {b.time_slot || ''}</td>
                    <td className="p-3 font-semibold text-success">${Number(b.price_usdc || 0).toFixed(0)}</td>
                    <td className="p-3">
                      <Badge variant={ESCROW_VARIANTS[b.escrow_status] || 'outline'}>
                        {b.escrow_status || 'none'}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {b.meeting_url
                        ? <a className="text-brand hover:underline text-xs"
                            href={b.meeting_url} target="_blank" rel="noopener noreferrer">Join</a>
                        : <span className="text-xs text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
