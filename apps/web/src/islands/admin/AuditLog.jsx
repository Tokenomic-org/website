/**
 * AuditLog — paginated read of audit_log. Cursor pagination by id (DESC).
 */

import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Badge } from '@ui/Badge.jsx';

const PAGE = 50;

export default function AuditLog() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async (before) => {
    setLoading(true);
    try {
      const url = '/admin/audit?limit=' + PAGE + (before ? `&before=${before}` : '');
      const r = await api(url, { credentials: 'include' });
      setItems((prev) => before ? prev.concat(r.items || []) : (r.items || []));
      setCursor(r.nextBefore || null);
      if (!r.items || r.items.length < PAGE) setDone(true);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(null); }, []); // eslint-disable-line

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted">
          Every admin action is recorded here with the signing wallet and (when applicable)
          the on-chain transaction hash.
        </p>
      </header>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Actor</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Target</th>
                <th className="text-left px-4 py-3">Tx</th>
                <th className="text-left px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No audit entries yet.</td></tr>
              )}
              {items.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{r.created_at}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.actor_wallet ? `${r.actor_wallet.slice(0, 6)}…${r.actor_wallet.slice(-4)}` : '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{r.action}</Badge></td>
                  <td className="px-4 py-3 text-xs">{r.target_type}{r.target_id ? `#${r.target_id}` : ''}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.tx_hash
                      ? <a className="text-brand underline" target="_blank" rel="noopener"
                           href={`https://basescan.org/tx/${r.tx_hash}`}>
                          {r.tx_hash.slice(0, 10)}…
                        </a>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted max-w-xs break-words">
                    {r.metadata ? <code>{JSON.stringify(r.metadata)}</code> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="text-center">
        {!done && (
          <Button variant="outline" loading={loading} onClick={() => load(cursor)}>
            Load older
          </Button>
        )}
        {done && items.length > 0 && <div className="text-xs text-muted">— end of log —</div>}
      </div>
    </section>
  );
}
