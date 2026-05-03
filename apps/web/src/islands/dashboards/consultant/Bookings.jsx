import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Button } from '@ui/Button.jsx';
import { useToast } from '@ui/Toast.jsx';

const ESCROW_VARIANTS = {
  none: 'outline', held: 'accent', released: 'success', disputed: 'danger', refunded: 'outline',
};

export default function Bookings() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const q = filter ? `?escrow_status=${filter}` : '';
      const r = await api('/api/consultant/me/bookings' + q, { credentials: 'include' });
      setItems(r.items || []);
    } catch (e) { toast.push({ variant: 'danger', title: 'Failed', description: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filter]);

  const transition = async (b, next) => {
    if (!confirm(`Move escrow to "${next}"? This may submit an on-chain BookingEscrow tx.`)) return;
    setBusy({ ...busy, [b.id]: next });
    try {
      let tx_hash = '';
      if (window.TokenomicWeb3 && typeof window.TokenomicWeb3.bookingEscrow === 'function') {
        try { tx_hash = await window.TokenomicWeb3.bookingEscrow({ id: b.id, action: next }); }
        catch (e) { toast.push({ variant: 'warning', title: 'On-chain skipped', description: e.message }); }
      }
      await api(`/api/consultant/bookings/${b.id}/escrow`, {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ escrow_status: next, tx_hash }),
      });
      load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Update failed', description: e.message }); }
    finally { setBusy({ ...busy, [b.id]: null }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-fg">Bookings</h2>
          <p className="text-sm text-muted">Sessions booked by learners, with on-chain escrow status.</p>
        </div>
        <select className="h-9 px-3 rounded-md border border-border bg-surface text-sm"
          value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All escrow states</option>
          <option value="held">Held</option><option value="released">Released</option>
          <option value="disputed">Disputed</option><option value="refunded">Refunded</option>
        </select>
      </div>

      {loading ? <div className="text-muted text-sm">Loading…</div> : (
        <Card><CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-muted">
              <th className="p-3">Service</th><th className="p-3">Client</th><th className="p-3">When</th>
              <th className="p-3">Price</th><th className="p-3">Escrow</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="p-3">{b.service_title || b.topic || '—'}</td>
                  <td className="p-3">
                    <div className="font-medium">{b.client_display_name || b.client_name || '—'}</div>
                    <div className="font-mono text-xs text-muted">{(b.client_wallet || '').slice(0, 10)}…</div>
                  </td>
                  <td className="p-3 text-xs text-muted">{b.booking_date} {b.time_slot}</td>
                  <td className="p-3 font-semibold text-success">${Number(b.price_usdc || 0).toFixed(0)}</td>
                  <td className="p-3"><Badge variant={ESCROW_VARIANTS[b.escrow_status] || 'outline'}>{b.escrow_status || 'none'}</Badge></td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      {b.escrow_status !== 'released' && (
                        <Button size="sm" variant="outline" loading={busy[b.id] === 'released'}
                          onClick={() => transition(b, 'released')}>Release</Button>
                      )}
                      {b.escrow_status !== 'disputed' && b.escrow_status !== 'released' && (
                        <Button size="sm" variant="ghost" loading={busy[b.id] === 'disputed'}
                          onClick={() => transition(b, 'disputed')}>Dispute</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan={6} className="p-6 text-center text-muted text-sm">No bookings yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}
