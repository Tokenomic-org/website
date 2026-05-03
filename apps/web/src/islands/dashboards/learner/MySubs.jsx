import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Button } from '@ui/Button.jsx';

const STATUS_VARIANT = {
  active: 'success', past_due: 'warning', cancelled: 'outline',
};

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

export default function MySubs({ wallet }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chainSub, setChainSub] = useState(null);

  useEffect(() => {
    api('/api/me/subscriptions', { credentials: 'include' })
      .then((r) => setItems(r.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  // Best-effort on-chain SubscriptionManager.subscriptions(wallet) read.
  // window.TokenomicWeb3 may expose this via the existing wallet stack.
  useEffect(() => {
    if (!wallet || typeof window === 'undefined') return;
    const helper = window.TokenomicWeb3 && window.TokenomicWeb3.readSubscription;
    if (typeof helper !== 'function') return;
    helper(wallet).then((s) => setChainSub(s)).catch(() => {});
  }, [wallet]);

  if (loading) return <div className="text-muted text-sm">Loading subscriptions…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Subscriptions</h2>
        <p className="text-sm text-muted">Active recurring payments and renewal dates.</p>
      </div>

      {chainSub && chainSub.active && (
        <Card><CardContent>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold">Tokenomic Premium</div>
              <p className="text-xs text-muted">On-chain SubscriptionManager — Base</p>
            </div>
            <div className="text-right">
              <Badge variant="success">Active</Badge>
              <div className="text-xs text-muted mt-1">Renews {fmtDate(chainSub.renews_at)}</div>
            </div>
          </div>
        </CardContent></Card>
      )}

      {items.length === 0 && !chainSub?.active ? (
        <Card><CardContent className="py-10 text-center">
          <p className="text-muted mb-3">No active subscription.</p>
          <Button onClick={() => (window.location.href = '/pricing/')}>See plans</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <Card key={s.id}><CardContent>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold capitalize">{s.target_type} #{s.target_id}</div>
                  <div className="text-xs text-muted">
                    ${Number(s.amount_usdc || 0).toFixed(2)} USDC · {s.period}
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={STATUS_VARIANT[s.status] || 'outline'}>{s.status}</Badge>
                  <div className="text-xs text-muted mt-1">
                    {s.status === 'active'
                      ? `Renews ${fmtDate(s.current_period_end)}`
                      : `Started ${fmtDate(s.created_at)}`}
                  </div>
                </div>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
