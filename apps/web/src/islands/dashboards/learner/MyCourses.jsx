import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Button } from '@ui/Button.jsx';

const BASE_TX_URL = 'https://basescan.org/tx/';

export default function MyCourses() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/me/courses', { credentials: 'include' })
      .then((r) => setItems(r.items || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted text-sm">Loading your courses…</div>;
  if (error)   return <div className="text-danger text-sm">{error}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Courses</h2>
        <p className="text-sm text-muted">Continue watching and pick up your certificates.</p>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-10 text-center">
          <p className="text-muted mb-3">You haven't enrolled in any courses yet.</p>
          <Button onClick={() => (window.location.href = '/courses/')}>Browse courses</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((e) => {
            const progress = Math.max(0, Math.min(100, Number(e.progress || 0)));
            const completed = progress >= 100 || !!e.cert_token_id;
            return (
              <Card key={e.enrollment_id || e.course_id} hover>
                <CardContent>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-semibold leading-snug line-clamp-2">{e.title || 'Untitled course'}</h3>
                    {completed
                      ? <Badge variant="success">Completed</Badge>
                      : <Badge variant="outline">{progress}%</Badge>}
                  </div>
                  <p className="text-xs text-muted line-clamp-2 min-h-[2.4em]">{e.description || ''}</p>
                  <div className="mt-3 h-1.5 bg-surface2 rounded overflow-hidden">
                    <div className="h-full bg-brand" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-muted">
                      by {e.educator_name || (e.educator_wallet || '').slice(0, 8) + '…'}
                    </span>
                    <Button size="sm" variant="outline"
                      onClick={() => (window.location.href = e.slug ? `/courses/${e.slug}` : '/courses/')}>
                      {completed ? 'Review' : 'Continue'}
                    </Button>
                  </div>
                  {(e.cert_token_id || e.cert_tx_hash) && (
                    <div className="mt-3 pt-3 border-t border-border text-xs flex items-center justify-between">
                      <span className="text-success">Certificate minted</span>
                      {e.cert_tx_hash && (
                        <a href={BASE_TX_URL + e.cert_tx_hash} target="_blank" rel="noopener noreferrer"
                          className="text-brand hover:underline font-mono">
                          {e.cert_tx_hash.slice(0, 10)}…
                        </a>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
