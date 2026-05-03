import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Button } from '@ui/Button.jsx';

export default function MyCommunities() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/me/communities', { credentials: 'include' })
      .then((r) => setItems(r.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted text-sm">Loading communities…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Communities</h2>
        <p className="text-sm text-muted">Groups you've joined.</p>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-10 text-center">
          <p className="text-muted mb-3">You haven't joined any communities yet.</p>
          <Button onClick={() => (window.location.href = '/communities/')}>Browse communities</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((c) => (
            <Card key={c.membership_id} hover><CardContent>
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="font-semibold line-clamp-1">{c.name || 'Community'}</h3>
                <Badge variant={c.role === 'owner' || c.role === 'moderator' ? 'brand' : 'outline'}>
                  {c.role}
                </Badge>
              </div>
              <p className="text-xs text-muted line-clamp-2 min-h-[2.4em]">{c.description || ''}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted">
                <span>{c.members_count || 0} members</span>
                <span>{c.courses_count || 0} courses</span>
                {c.tier && <Badge variant="outline">{c.tier}</Badge>}
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="outline"
                  onClick={() => (window.location.href = c.slug ? `/community/?slug=${c.slug}` : '/communities/')}>
                  Open
                </Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
