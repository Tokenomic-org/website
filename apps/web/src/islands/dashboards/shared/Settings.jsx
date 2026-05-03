import React from 'react';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Badge } from '@ui/Badge.jsx';

/**
 * Settings — Phase-4 placeholders for calendar OAuth + treasury settings.
 * Real connections (Google, Microsoft, Calendly) ship with the calendar sync.
 */
export default function Settings({ session }) {
  const wallet = session?.address || '';
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Settings</h2>
        <p className="text-sm text-muted">Connections and account configuration.</p>
      </div>

      <Card><CardContent>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold">Connected wallet</h3>
            <p className="text-xs font-mono text-muted">{wallet || 'Not connected'}</p>
          </div>
          <Badge variant="brand">SIWE</Badge>
        </div>
      </CardContent></Card>

      {['Google Calendar', 'Microsoft Outlook', 'Calendly'].map((label) => (
        <Card key={label}><CardContent className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold">{label}</h3>
            <p className="text-sm text-muted">Sync free/busy and write confirmed bookings to your calendar.</p>
          </div>
          <Button variant="outline" disabled title="Available in Phase 4">Connect (Phase 4)</Button>
        </CardContent></Card>
      ))}

      <Card><CardContent>
        <h3 className="font-semibold">Payouts</h3>
        <p className="text-sm text-muted">USDC settles on Base via RevenueSplitter — no off-chain bank required.</p>
      </CardContent></Card>
    </div>
  );
}
