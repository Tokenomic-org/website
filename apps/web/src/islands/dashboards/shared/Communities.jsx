import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Button } from '@ui/Button.jsx';
import { useToast } from '@ui/Toast.jsx';

/**
 * Communities the caller leads. Read-only summary in this phase — full
 * moderation tools live in /dashboard-communities/.
 */
export default function Communities({ wallet }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    if (!wallet) { setLoading(false); return; }
    api(`/api/communities?educator=${wallet}`)
      .then((r) => setItems(r.items || []))
      .catch((e) => toast.push({ variant: 'danger', title: 'Failed', description: e.message }))
      .finally(() => setLoading(false));
  }, [wallet]);

  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-fg">Communities</h2>
          <p className="text-sm text-muted">Groups you lead.</p>
        </div>
        <Button variant="outline" onClick={() => (window.location.href = '/dashboard-communities/')}>
          Open community moderation
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((c) => (
          <Card key={c.id} hover><CardContent>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">{c.name}</h3>
              <Badge variant={c.status === 'active' ? 'success' : 'outline'}>{c.status}</Badge>
            </div>
            <p className="text-sm text-muted line-clamp-2">{c.description}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted">
              <span>{c.members_count || 0} members</span>
              <span>{c.courses_count || 0} courses</span>
            </div>
          </CardContent></Card>
        ))}
        {!items.length && (
          <Card><CardContent>
            <p className="text-muted text-sm text-center py-6">You don't run any communities yet.</p>
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}
