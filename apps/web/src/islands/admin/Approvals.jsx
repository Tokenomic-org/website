/**
 * Approvals module — pending educator/consultant applications. Approve writes
 * the role into profiles + records audit; Reject requires a >=10-char reason.
 * KYC documents are listed via /admin/approvals/:id/docs and streamed inline
 * via /admin/approvals/:id/docs/:key (R2-backed; gated by the admin guard).
 */

import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { sendRoleTx } from '@lib/wagmi-tx.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

export default function Approvals() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [docs, setDocs] = useState({}); // { id: [{key,size,uploaded}] }
  const [busy, setBusy] = useState({});
  const [registry, setRegistry] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api('/admin/role-registry', { credentials: 'include' })
      .then(setRegistry)
      .catch(() => { /* approve will surface a friendly error */ });
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api('/admin/approvals', { credentials: 'include' });
      setItems(r.items || []);
    } catch (e) {
      toast.error('Could not load approvals: ' + e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const toggleOpen = async (id) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (next && !docs[id]) {
      try {
        const r = await api(`/admin/approvals/${id}/docs`, { credentials: 'include' });
        setDocs((d) => ({ ...d, [id]: r.items || [] }));
      } catch (e) {
        setDocs((d) => ({ ...d, [id]: [] }));
        toast.error('KYC docs unavailable: ' + e.message);
      }
    }
  };

  const approve = async (a) => {
    const id = a.id;
    const target = a.applicant_wallet;
    const role = a.role_requested === 'consultant' ? 'CONSULTANT_ROLE' : 'EDUCATOR_ROLE';
    if (!confirm(`Approve application #${id} and grant ${role} on-chain to ${target.slice(0, 10)}…?`)) return;
    setBusy((b) => ({ ...b, [id]: 'approve' }));
    let tx_hash = null;
    try {
      // Step 1 — on-chain grant via wagmi. Skipped only when the worker has
      // no RoleRegistry configured (dev/preview).
      if (registry?.address && registry.roles?.[role]) {
        tx_hash = await sendRoleTx({
          registry: registry.address,
          action: 'grant',
          roleHash: registry.roles[role],
          target,
        });
        toast.success(`On-chain grant tx ${tx_hash.slice(0, 10)}… — finalizing approval`);
      } else if (registry && !registry.address) {
        toast.success('RoleRegistry not configured — recording off-chain approval');
      }
      // Step 2 — record approval (worker enforces tx_hash when registry set).
      await api(`/admin/approvals/${id}/approve`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ tx_hash }),
      });
      toast.success('Approved');
      load();
    } catch (e) { toast.error(e.message || 'Approve failed'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  };

  const reject = async (id) => {
    const reason = prompt('Rejection reason (≥10 chars):');
    if (!reason || reason.trim().length < 10) {
      toast.error('Reason must be at least 10 characters');
      return;
    }
    setBusy((b) => ({ ...b, [id]: 'reject' }));
    try {
      await api(`/admin/approvals/${id}/reject`, {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ admin_feedback: reason.trim() }),
      });
      toast.success('Rejected');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  };

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-muted">
          Educator &amp; consultant applications awaiting review. Approving writes the role
          to the user's profile and queues an on-chain grant.
        </p>
      </header>

      {loading && <Card><CardContent className="text-center text-muted py-8">Loading…</CardContent></Card>}
      {!loading && items.length === 0 && (
        <Card><CardContent className="text-center text-muted py-8">No pending applications. 🎉</CardContent></Card>
      )}

      <div className="space-y-3">
        {items.map((a) => (
          <Card key={a.id}>
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={a.role_requested === 'consultant' ? 'accent' : 'success'}>
                      {a.role_requested}
                    </Badge>
                    <span className="text-xs text-muted">#{a.id} · {a.created_at}</span>
                  </div>
                  <div className="font-mono text-xs break-all">{a.applicant_wallet}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleOpen(a.id)}>
                    {openId === a.id ? 'Hide' : 'Review'}
                  </Button>
                  <Button size="sm" loading={busy[a.id] === 'approve'} onClick={() => approve(a)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" loading={busy[a.id] === 'reject'} onClick={() => reject(a.id)}>
                    Reject
                  </Button>
                </div>
              </div>

              {openId === a.id && (
                <div className="space-y-3 pt-3 border-t border-border">
                  <div>
                    <div className="text-xs uppercase text-muted mb-1">Bio</div>
                    <p className="text-sm whitespace-pre-wrap">{a.bio}</p>
                  </div>
                  {a.expertise && (
                    <Field label="Expertise">{prettyJson(a.expertise)}</Field>
                  )}
                  {a.sample_url    && <Field label="Sample"><a href={a.sample_url} target="_blank" rel="noopener" className="text-brand underline break-all">{a.sample_url}</a></Field>}
                  {a.portfolio_url && <Field label="Portfolio"><a href={a.portfolio_url} target="_blank" rel="noopener" className="text-brand underline break-all">{a.portfolio_url}</a></Field>}
                  {a.hourly_rate_usdc != null && <Field label="Hourly rate">${a.hourly_rate_usdc} USDC</Field>}
                  {a.availability && <Field label="Availability">{a.availability}</Field>}
                  {a.credentials  && <Field label="Credentials">{a.credentials}</Field>}
                  {a.stake_tx_hash && <Field label="Stake tx"><code className="text-xs break-all">{a.stake_tx_hash}</code></Field>}

                  <div>
                    <div className="text-xs uppercase text-muted mb-1">KYC docs</div>
                    {!docs[a.id] && <div className="text-sm text-muted">Loading…</div>}
                    {docs[a.id]?.length === 0 && <div className="text-sm text-muted">No documents on file.</div>}
                    {docs[a.id]?.length > 0 && (
                      <ul className="text-sm space-y-1">
                        {docs[a.id].map((d) => (
                          <li key={d.key}>
                            <a
                              className="text-brand underline"
                              href={`${(window.TOKENOMIC_API_BASE || '').replace(/\/+$/, '')}/admin/approvals/${a.id}/docs/${encodeURIComponent(d.key.split('/').pop())}`}
                              target="_blank" rel="noopener"
                            >
                              {d.key.split('/').pop()}
                            </a>
                            <span className="text-muted text-xs ml-2">({Math.round((d.size || 0) / 1024)} KB)</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted mb-1">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function prettyJson(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.join(', ') : JSON.stringify(v); }
  catch { return s; }
}
