/**
 * Users module — search wallets, view their role set, and submit
 * RoleRegistry grant/revoke transactions through the site-wide wagmi
 * facade (`window.TokenomicWeb3`, see lib/wagmi-tx.js).
 *
 * The split with the worker:
 *   - GET  /admin/role-registry            -> deployed addr + bytes32 role hashes
 *   - on-chain tx is signed in the browser via wagmi.writeContract
 *   - POST /admin/users/:wallet/role/confirm tx_hash + audit + cache invalidate
 */

import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { sendRoleTx } from '@lib/wagmi-tx.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

const ROLE_OPTIONS = [
  { id: 'EDUCATOR_ROLE',   label: 'Educator' },
  { id: 'CONSULTANT_ROLE', label: 'Consultant' },
  { id: 'PLATFORM_ROLE',   label: 'Platform' },
];

export default function Users() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registry, setRegistry] = useState(null);
  const [pending, setPending] = useState({});
  const toast = useToast();

  useEffect(() => {
    api('/admin/role-registry', { credentials: 'include' })
      .then(setRegistry)
      .catch((e) => toast.error('Could not load RoleRegistry config: ' + e.message));
  }, [toast]);

  const search = async (term) => {
    setLoading(true);
    try {
      const data = await api(
        '/admin/users' + (term ? `?q=${encodeURIComponent(term)}` : ''),
        { credentials: 'include' },
      );
      setItems(data.items || []);
    } catch (e) {
      toast.error('Search failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { search(''); }, []); // eslint-disable-line

  const onSubmit = (e) => { e.preventDefault(); search(q.trim()); };

  const doRoleTx = async (user, roleId, action) => {
    if (!registry?.address) {
      toast.error('RoleRegistry address is not configured on the worker (env.ROLE_REGISTRY).');
      return;
    }
    const roleHash = registry.roles?.[roleId];
    if (!roleHash) { toast.error('Unknown role'); return; }
    const k = `${user.wallet_address}:${roleId}:${action}`;
    setPending((p) => ({ ...p, [k]: true }));
    try {
      const tx = await sendRoleTx({
        registry: registry.address,
        action,
        roleHash,
        target: user.wallet_address,
      });
      toast.success(`${action === 'grant' ? 'Granted' : 'Revoked'} ${roleId} — tx ${tx.slice(0, 10)}…`);
      await api(`/admin/users/${user.wallet_address}/role/confirm`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ action, role: roleId, tx_hash: tx }),
      });
      setTimeout(() => search(q.trim()), 1500);
    } catch (e) {
      toast.error(e?.message || 'Transaction failed');
    } finally {
      setPending((p) => { const n = { ...p }; delete n[k]; return n; });
    }
  };

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Users &amp; roles</h1>
        <p className="text-sm text-muted">
          Search by wallet, ENS, display name, or email. Grant/revoke calls are signed by your
          connected admin wallet (wagmi) and broadcast to the RoleRegistry contract.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="0xabc… or vitalik.eth or display name"
          className="flex-1"
        />
        <Button type="submit">Search</Button>
      </form>

      {!registry?.address && (
        <Card><CardContent className="text-sm text-muted">
          <strong>RoleRegistry not configured.</strong> Set <code>ROLE_REGISTRY</code> in
          the worker env to enable on-chain role grants. You can still review users here.
        </CardContent></Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Wallet</th>
                <th className="text-left px-4 py-3">Display</th>
                <th className="text-left px-4 py-3">Roles</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No users match.</td></tr>
              )}
              {items.map((u) => (
                <tr key={u.wallet_address} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-mono text-xs break-all">{u.wallet_address}</td>
                  <td className="px-4 py-3">{u.display_name || <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(u.roles || ['learner']).map((r) => (
                        <Badge key={r} variant={r === 'admin' ? 'brand' : 'outline'}>{r}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {ROLE_OPTIONS.map((opt) => {
                        const has = (u.roles || []).includes(
                          opt.id.replace('_ROLE', '').toLowerCase()
                        );
                        const action = has ? 'revoke' : 'grant';
                        const k = `${u.wallet_address}:${opt.id}:${action}`;
                        return (
                          <Button
                            key={opt.id}
                            size="sm"
                            variant={has ? 'danger' : 'outline'}
                            loading={!!pending[k]}
                            onClick={() => doRoleTx(u, opt.id, action)}
                          >
                            {has ? `Revoke ${opt.label}` : `Grant ${opt.label}`}
                          </Button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}
