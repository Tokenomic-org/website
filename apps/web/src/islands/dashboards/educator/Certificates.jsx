import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Badge } from '@ui/Badge.jsx';
import { useToast } from '@ui/Toast.jsx';

/**
 * Batch issue certificates via CertificateNFT.mintBatch from the connected
 * educator wallet. This UI records the tx hash + recipients to D1; the actual
 * on-chain call is performed by the wallet using the existing TokenomicWeb3
 * facade. We submit a placeholder tx_hash field so this works in dev too.
 */
export default function Certificates() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [recipients, setRecipients] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const toast = useToast();

  const load = async () => {
    try {
      const [c, r] = await Promise.all([
        api('/api/educator/me/courses', { credentials: 'include' }),
        api('/api/educator/me/certificates/recent', { credentials: 'include' }),
      ]);
      setCourses(c.items || []);
      if (c.items?.length && !courseId) setCourseId(c.items[0].id);
      setRecent(r.items || []);
    } catch (e) { toast.push({ variant: 'danger', title: 'Failed', description: e.message }); }
  };
  useEffect(() => { load(); }, []);

  const issue = async () => {
    const list = recipients.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!courseId || !list.length) return;
    setBusy(true);
    try {
      // Try to send the on-chain batch via the existing wallet facade. If no
      // contract is configured we still record the recipients so the educator
      // can hand-off to a treasury minter later.
      let tx_hash = '';
      try {
        if (window.TokenomicWeb3 && typeof window.TokenomicWeb3.mintCertificateBatch === 'function') {
          tx_hash = await window.TokenomicWeb3.mintCertificateBatch({ courseId, recipients: list });
        }
      } catch (chainErr) {
        toast.push({ variant: 'warning', title: 'On-chain skipped', description: chainErr.message });
      }
      const r = await api('/api/educator/certificates/batch', {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ course_id: courseId, recipients: list, tx_hash }),
      });
      toast.push({ variant: 'success', title: `${r.count} recipients queued` });
      setRecipients(''); load();
    } catch (e) { toast.push({ variant: 'danger', title: 'Issue failed', description: e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Certificates</h2>
        <p className="text-sm text-muted">Batch-issue on-chain CertificateNFT tokens to course completers.</p>
      </div>

      <Card><CardContent className="space-y-3">
        <div>
          <label className="text-xs text-muted block mb-1">Course</label>
          <select className="h-10 px-3 rounded-md border border-border bg-surface w-full text-sm"
            value={courseId || ''} onChange={(e) => setCourseId(Number(e.target.value))}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Recipients (one address per line)</label>
          <textarea rows={5} className="w-full p-3 rounded-md border border-border bg-surface text-xs font-mono"
            placeholder="0x…&#10;0x…" value={recipients}
            onChange={(e) => setRecipients(e.target.value)} />
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted">Tx is submitted by your connected wallet via CertificateNFT.mintBatch.</span>
          <Button onClick={issue} loading={busy} disabled={!courseId || !recipients.trim()}>Issue batch</Button>
        </div>
      </CardContent></Card>

      <Card><CardContent>
        <h3 className="text-sm font-semibold text-fg mb-3">Recent mints</h3>
        <div className="space-y-2">
          {recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs border-b border-border pb-2 last:border-0">
              <span className="font-mono">{r.recipient_wallet.slice(0, 10)}… → course #{r.course_id}</span>
              <span className="flex items-center gap-2">
                <Badge variant={r.status === 'confirmed' ? 'success' : 'outline'}>{r.status}</Badge>
                <span className="text-muted">{(r.created_at || '').slice(0, 10)}</span>
              </span>
            </div>
          ))}
          {!recent.length && <p className="text-muted text-sm">No mints yet.</p>}
        </div>
      </CardContent></Card>
    </div>
  );
}
