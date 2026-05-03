/**
 * Revenue — D1 aggregates (active subscriptions, total USDC processed,
 * top educators) plus a single on-chain read of the platform treasury USDC
 * balance. All sourced from /admin/revenue.
 */

import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { useToast } from '@ui/Toast.jsx';

export default function Revenue() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api('/admin/revenue', { credentials: 'include' })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { toast.error(e.message); setLoading(false); });
  }, []); // eslint-disable-line

  if (loading) return <div className="text-muted">Loading revenue…</div>;
  if (!data) return null;

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Revenue</h1>
        <p className="text-sm text-muted">
          Database aggregates plus on-chain treasury balance. Refreshed on each load.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Total USDC processed" value={`$${fmt(data.d1.totalUsdcProcessed)}`} accent />
        <Stat label="Active subscriptions" value={fmt(data.d1.activeSubscriptions)} />
        <Stat
          label="Treasury balance (on-chain)"
          value={data.onChain.treasuryUsdc ? `$${fmt(Number(data.onChain.treasuryUsdc))}` : '—'}
          sub={data.onChain.treasury || 'PLATFORM_TREASURY not set'}
        />
      </div>

      <Card>
        <CardContent>
          <h2 className="text-base font-semibold mb-3">Top educators by listed price</h2>
          {data.d1.topEducators.length === 0 && <div className="text-muted text-sm">No active courses yet.</div>}
          {data.d1.topEducators.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-muted text-xs uppercase tracking-wide">
                <tr><th className="text-left py-2">Wallet</th><th className="text-right py-2">Courses</th><th className="text-right py-2">Total $USDC</th></tr>
              </thead>
              <tbody>
                {data.d1.topEducators.map((e) => (
                  <tr key={e.wallet} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{e.wallet}</td>
                    <td className="py-2 text-right">{e.courses}</td>
                    <td className="py-2 text-right">${fmt(e.total_priced)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
        <div className={'text-3xl font-bold mt-1 ' + (accent ? 'text-brand' : 'text-fg')}>{value}</div>
        {sub && <div className="text-xs text-muted mt-1 break-all">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function fmt(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
