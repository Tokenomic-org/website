import React, { useEffect, useState } from 'react';
import { api } from '@lib/api.js';
import { Card, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { useToast } from '@ui/Toast.jsx';

const PREF_KEY = 'tkn_notif_prefs';
const THEME_KEY = 'tkn_theme_override';

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return { booking_email: true, course_email: true, referral_email: true, ...raw };
  } catch { return { booking_email: true, course_email: true, referral_email: true }; }
}

function loadTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}

export default function Settings({ session }) {
  const wallet = session?.address || '';
  const [profile, setProfile] = useState({ display_name: '', email: '', bio: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [prefs, setPrefs]     = useState(loadPrefs());
  const [theme, setTheme]     = useState(loadTheme());
  const toast = useToast();

  useEffect(() => {
    api('/api/auth/me', { credentials: 'include' })
      .then((r) => {
        const p = r.profile || {};
        setProfile({
          display_name: p.display_name || '',
          email:        p.email || '',
          bio:          p.bio || '',
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/me/profile', {
        method: 'PATCH', credentials: 'include',
        body: JSON.stringify(profile),
      });
      toast.push({ variant: 'success', title: 'Profile saved' });
    } catch (e) {
      toast.push({ variant: 'danger', title: 'Save failed', description: e.message });
    } finally { setSaving(false); }
  };

  const savePrefs = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch {}
  };

  const saveTheme = (t) => {
    setTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    if (t === 'system') document.documentElement.classList.remove('dark', 'light');
    else { document.documentElement.classList.toggle('dark', t === 'dark');
           document.documentElement.classList.toggle('light', t === 'light'); }
  };

  if (loading) return <div className="text-muted text-sm">Loading settings…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Settings</h2>
        <p className="text-sm text-muted">Profile, notifications, and theme.</p>
      </div>

      <Card><CardContent className="space-y-3">
        <h3 className="font-semibold">Profile</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted">Display name</label>
            <Input value={profile.display_name}
              onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted">Email (for notifications)</label>
            <Input type="email" value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted">Bio</label>
          <textarea rows={3} className="w-full p-3 rounded-md border border-border bg-surface text-sm"
            value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
        </div>
        <div className="text-xs text-muted">
          Wallet: <span className="font-mono">{wallet}</span>
        </div>
        <Button onClick={save} loading={saving}>Save profile</Button>
      </CardContent></Card>

      <Card><CardContent className="space-y-2">
        <h3 className="font-semibold">Notification preferences</h3>
        <p className="text-xs text-muted">
          Email delivery ships with the notifications backend. Preferences are
          stored locally for now.
        </p>
        {[
          ['booking_email',  'Booking confirmations & reminders'],
          ['course_email',   'New lessons in courses I follow'],
          ['referral_email', 'Referral payouts'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!prefs[key]}
              onChange={(e) => savePrefs({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </CardContent></Card>

      <Card><CardContent className="space-y-2">
        <h3 className="font-semibold">Theme</h3>
        <div className="flex gap-2">
          {['system', 'light', 'dark'].map((t) => (
            <Button key={t} size="sm" variant={theme === t ? 'default' : 'outline'}
              onClick={() => saveTheme(t)}>{t}</Button>
          ))}
        </div>
      </CardContent></Card>
    </div>
  );
}
