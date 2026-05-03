import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

/**
 * Revenue panel — lists claimable shares from RevenueSplitter and exposes a
 * Claim button. The on-chain claim call is delegated to the existing
 * TokenomicWeb3 facade when available.
 */
export default function Revenue() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api('/api/educator/me/revenue/splits', { credentials: 'include' });
      setData(r);
    } catch (e) { toast.push({ variant: 'danger', title: 'Failed', description: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const claim = async () => {
    setBusy(true);
    try {
      let tx_hash = '';
      if (window.TokenomicWeb3 && typeof window.TokenomicWeb3.claimSplit === 'function') {
        tx_hash = await window.TokenomicWeb3.claimSplit({ wallet: data.wallet });
      } else {
        toast.push({ variant: 'warning', title: 'Wallet helper unavailable', description: 'RevenueSplitter helper not loaded — claim manually.' });
      }
      if (tx_hash) toast.push({ variant: 'success', title: 'Claim submitted', description: tx_hash.slice(0, 12) + '…' });
      load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Claim failed', description: e.message }); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="text-muted text-sm">Loading…</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Revenue</h2>
        <p className="text-sm text-muted">Claimable shares from RevenueSplitter and lifetime earnings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent>
          <div className="text-xs text-muted">Claimable now</div>
          <div className="text-3xl font-bold text-success">${(data.claimable_usdc || 0).toFixed(2)}</div>
          <Button className="mt-3" onClick={claim} loading={busy} disabled={!data.claimable_usdc}>Claim USDC</Button>
        </CardContent></Card>
        <Card><CardContent>
          <div className="text-xs text-muted">Lifetime earnings</div>
          <div className="text-3xl font-bold text-fg">${(data.lifetime_usdc || 0).toFixed(2)}</div>
          <p className="text-xs text-muted mt-3">Across all courses, articles and bookings.</p>
        </CardContent></Card>
      </div>

      <Card><CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-left text-muted">
            <th className="p-3">Description</th><th className="p-3">From</th><th className="p-3">Amount</th>
            <th className="p-3">Status</th><th className="p-3">When</th>
          </tr></thead>
          <tbody>
            {(data.items || []).map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="p-3">{t.description || '—'}</td>
                <td className="p-3 font-mono text-xs text-muted">{(t.sender_wallet || '').slice(0, 10)}…</td>
                <td className="p-3 font-semibold text-success">${Number(t.amount_usdc || 0).toFixed(2)}</td>
                <td className="p-3"><Badge variant={t.status === 'confirmed' ? 'success' : 'outline'}>{t.status}</Badge></td>
                <td className="p-3 text-xs text-muted">{(t.created_at || '').slice(0, 10)}</td>
              </tr>
            ))}
            {!data.items.length && (
              <tr><td colSpan={5} className="p-6 text-center text-muted text-sm">No revenue yet.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
