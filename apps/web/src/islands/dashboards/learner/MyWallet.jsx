import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';

const BASE_TX_URL = 'https://basescan.org/tx/';

export default function MyWallet({ wallet }) {
  const [data, setData] = useState({ recent_tx: [] });
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState({ ens: null, base: null });

  useEffect(() => {
    api('/api/me/wallet', { credentials: 'include' })
      .then((r) => setData(r))
      .catch(() => setData({ recent_tx: [] }))
      .finally(() => setLoading(false));
  }, []);

  // Best-effort name resolution via TokenomicWeb3 (already loaded on shells).
  useEffect(() => {
    if (!wallet || typeof window === 'undefined') return;
    const w3 = window.TokenomicWeb3;
    if (!w3) return;
    if (typeof w3.resolveEns === 'function')      w3.resolveEns(wallet).then((n) => setName((p) => ({ ...p, ens: n }))).catch(() => {});
    if (typeof w3.resolveBaseName === 'function') w3.resolveBaseName(wallet).then((n) => setName((p) => ({ ...p, base: n }))).catch(() => {});
  }, [wallet]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Wallet</h2>
        <p className="text-sm text-muted">Connected addresses, names, and recent on-chain activity.</p>
      </div>

      <Card><CardContent>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs text-muted">Connected wallet</div>
            <div className="font-mono text-sm break-all">{wallet}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {name.ens  && <Badge variant="brand">ENS · {name.ens}</Badge>}
              {name.base && <Badge variant="brand">Base · {name.base}</Badge>}
              {!name.ens && !name.base && <span className="text-muted">No ENS / Base name resolved</span>}
            </div>
          </div>
          <Badge variant="success">SIWE</Badge>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="px-4 pt-4 pb-2 font-semibold">Recent on-chain activity</div>
        {loading ? (
          <div className="px-4 pb-4 text-sm text-muted">Loading…</div>
        ) : !data.recent_tx?.length ? (
          <div className="px-4 pb-4 text-sm text-muted">No on-chain transactions indexed yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-y border-border text-left text-muted">
                <th className="p-3">Description</th>
                <th className="p-3">Counterparty</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Tx</th>
              </tr></thead>
              <tbody>
                {data.recent_tx.map((t) => {
                  const counter = t.recipient_wallet?.toLowerCase() === (wallet || '').toLowerCase()
                    ? t.sender_wallet : t.recipient_wallet;
                  return (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="p-3">{t.description || '—'}</td>
                      <td className="p-3 font-mono text-xs text-muted">{(counter || '').slice(0, 10)}…</td>
                      <td className="p-3 font-semibold text-success">${Number(t.amount_usdc || 0).toFixed(2)}</td>
                      <td className="p-3"><Badge variant={t.status === 'confirmed' ? 'success' : 'outline'}>
                        {t.status}</Badge></td>
                      <td className="p-3">
                        {t.tx_hash
                          ? <a href={BASE_TX_URL + t.tx_hash} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-xs text-brand hover:underline">
                              {t.tx_hash.slice(0, 10)}…</a>
                          : <span className="text-xs text-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
