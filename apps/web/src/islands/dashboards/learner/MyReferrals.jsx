import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Button } from '@ui/Button.jsx';

export default function MyReferrals({ wallet }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api('/api/me/referrals', { credentials: 'include' })
      .then((r) => setData(r))
      .catch(() => setData({ items: [], signups_count: 0, earned_usdc: 0, pending_usdc: 0,
                             ref_link: `/?ref=${wallet || ''}` }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted text-sm">Loading referrals…</div>;
  if (!data) return null;

  const origin = (typeof window !== 'undefined' ? window.location.origin : '') || 'https://tokenomic.org';
  const fullLink = origin + (data.ref_link || `/?ref=${wallet || ''}`);

  const copy = async () => {
    try { await navigator.clipboard.writeText(fullLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Referrals</h2>
        <p className="text-sm text-muted">Earn USDC every time someone signs up via your link.</p>
      </div>

      <Card><CardContent>
        <label className="text-xs text-muted">Your referral link</label>
        <div className="flex items-center gap-2 mt-1">
          <input readOnly value={fullLink}
            className="flex-1 h-10 px-3 rounded-md border border-border bg-surface text-sm font-mono"
            onFocus={(e) => e.target.select()} />
          <Button onClick={copy} variant="outline">{copied ? 'Copied!' : 'Copy'}</Button>
        </div>
      </CardContent></Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="Signups attributed" value={data.signups_count || 0} />
        <Stat label="USDC earned"        value={`$${Number(data.earned_usdc || 0).toFixed(2)}`} />
        <Stat label="Pending payouts"    value={`$${Number(data.pending_usdc || 0).toFixed(2)}`} />
      </div>

      <Card><CardContent className="p-0">
        <div className="px-4 pt-4 pb-2 font-semibold">Recent attributions</div>
        {(!data.items || data.items.length === 0) ? (
          <div className="px-4 pb-4 text-sm text-muted">
            No referrals yet — share the link above to start earning.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-y border-border text-left text-muted">
                <th className="p-3">Referee</th>
                <th className="p-3">Event</th>
                <th className="p-3">Reward</th>
                <th className="p-3">Status</th>
                <th className="p-3">When</th>
              </tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-mono text-xs">
                      {r.referee_wallet ? r.referee_wallet.slice(0, 10) + '…' : '—'}
                    </td>
                    <td className="p-3 text-xs">{r.event_type || '—'}</td>
                    <td className="p-3 font-semibold text-success">
                      ${Number(r.reward_usdc || 0).toFixed(2)}
                    </td>
                    <td className="p-3"><Badge variant={
                      r.status === 'paid' ? 'success'
                      : r.status === 'qualified' ? 'accent'
                      : r.status === 'void' ? 'danger' : 'outline'
                    }>{r.status}</Badge></td>
                    <td className="p-3 text-xs text-muted">
                      {(r.paid_at || r.qualified_at || r.created_at || '').slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <Card><CardContent>
      <div className="text-2xl font-bold text-fg">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </CardContent></Card>
  );
}
