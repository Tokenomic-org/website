import React, { useEffect, useMemo, useState } from 'react';
import { api, isLoggedIn } from '../lib/api.js';

/**
 * BookingWidget — mounted on consultant profile pages. Reads merged
 * availability across the consultant's connected calendars and lets a
 * learner hold + confirm a 15/30/60-min slot.
 *
 * data-props:
 *   consultantWallet  hex address
 *   consultantName    display name (for UI)
 *   defaultDuration   minutes (15|30|60)  default 30
 *   defaultPriceUsdc  number (display, also passed to /confirm)
 */
export default function BookingWidget(props) {
  const wallet = (props.consultantWallet || '').toLowerCase();
  const name   = props.consultantName || 'this consultant';
  const [duration, setDuration] = useState(Number(props.defaultDuration) || 30);
  const [price]    = useState(Number(props.defaultPriceUsdc) || 0);
  const [dayOffset, setDayOffset] = useState(0); // days from today
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState(null);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [topic, setTopic]   = useState('');
  const [email, setEmail]   = useState('');
  const [txHash, setTxHash] = useState('');

  const range = useMemo(() => {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() + dayOffset);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { from: start.toISOString(), to: end.toISOString(), label: start };
  }, [dayOffset]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setLoad(true); setError(null); setPicked(null);
    api(`/api/availability/${wallet}?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&slot=${duration}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoad(false); });
    return () => { cancelled = true; };
  }, [wallet, range.from, range.to, duration]);

  async function handleHold(slot) {
    if (!isLoggedIn()) {
      setError('Connect your wallet first to hold a slot.');
      return;
    }
    setBusy(true); setError(null);
    try {
      await api('/api/bookings/hold', {
        method: 'POST',
        body: JSON.stringify({
          consultant_wallet: wallet,
          start_iso: slot.start,
          end_iso:   slot.end,
        }),
      });
      setPicked(slot);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function handleConfirm() {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const r = await api('/api/bookings/confirm', {
        method: 'POST',
        body: JSON.stringify({
          consultant_wallet: wallet,
          start_iso: picked.start,
          end_iso:   picked.end,
          topic, client_email: email,
          price_usdc: price,
          payment_tx_hash: txHash || null,
        }),
      });
      setConfirmed(r);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  if (confirmed) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-emerald-100">
        <div className="text-lg font-bold mb-1">✓ Booking confirmed</div>
        <div className="text-sm opacity-90">
          {fmtDay(picked.start)} · {fmtTime(picked.start)} – {fmtTime(picked.end)}
        </div>
        {confirmed.meeting_url && (
          <div className="mt-3 text-sm">
            Meeting link:{' '}
            <a className="underline text-emerald-200" href={confirmed.meeting_url}
               target="_blank" rel="noopener">{confirmed.meeting_url}</a>
          </div>
        )}
        {confirmed.warnings && confirmed.warnings.length > 0 && (
          <div className="mt-2 text-xs text-amber-200">{confirmed.warnings.join(' ')}</div>
        )}
        <a href="/bookings/" className="mt-4 inline-block text-sm underline opacity-90">
          View all my bookings →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[rgb(36,52,70)] bg-[rgb(16,25,36)] p-5 text-[#ECF4FA]">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-lg font-bold m-0">Book {name}</h3>
        <div className="text-sm opacity-75">
          {price > 0 ? `$${price} USDC` : 'Free'} · {duration} min
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        {[15, 30, 60].map(m => (
          <button key={m} type="button"
                  onClick={() => setDuration(m)}
                  className={
                    'px-3 py-1.5 rounded-md text-sm border transition ' +
                    (duration === m
                      ? 'bg-[#ff6000] border-[#ff6000] text-white'
                      : 'border-[rgb(36,52,70)] text-[#a5bcd0] hover:text-white')
                  }>
            {m} min
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={() => setDayOffset(d => Math.max(0, d - 1))}
                disabled={dayOffset === 0}
                className="px-2 py-1 rounded text-sm opacity-80 disabled:opacity-30">
          ← Prev
        </button>
        <div className="text-sm font-semibold">{fmtDayLabel(range.label)}</div>
        <button type="button" onClick={() => setDayOffset(d => Math.min(30, d + 1))}
                className="px-2 py-1 rounded text-sm opacity-80">
          Next →
        </button>
      </div>

      {loading && <div className="text-sm opacity-70">Loading availability…</div>}
      {error && <div className="text-sm text-red-300 mb-2">{error}</div>}

      {!loading && data && (
        <>
          {data.providers.length === 0 && (
            <div className="text-xs text-amber-300 mb-3 p-2 bg-amber-500/10 rounded">
              No calendar connected — slots assume Mon–Fri 09:00–18:00 UTC.
            </div>
          )}

          {!picked ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto">
              {data.slots.length === 0 && (
                <div className="col-span-full text-sm opacity-70 py-4 text-center">
                  No free slots on this day.
                </div>
              )}
              {data.slots.map(s => (
                <button key={s.start}
                        type="button" disabled={busy}
                        onClick={() => handleHold(s)}
                        className="px-2 py-2 rounded-md text-sm border border-[rgb(36,52,70)]
                                   hover:bg-[#ff6000] hover:border-[#ff6000] hover:text-white
                                   transition disabled:opacity-40">
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded bg-[rgb(11,18,27)] border border-[rgb(36,52,70)] text-sm">
                <div className="font-semibold">{fmtDay(picked.start)}</div>
                <div className="opacity-80">{fmtTime(picked.start)} – {fmtTime(picked.end)} UTC</div>
                <div className="text-xs opacity-60 mt-1">Hold expires in 15 minutes.</div>
              </div>
              <input type="text" placeholder="Topic (e.g. tokenomics review)"
                     value={topic} onChange={e => setTopic(e.target.value)}
                     className="w-full px-3 py-2 rounded bg-[rgb(11,18,27)] border border-[rgb(36,52,70)] text-sm" />
              <input type="email" placeholder="Email for the calendar invite"
                     value={email} onChange={e => setEmail(e.target.value)}
                     className="w-full px-3 py-2 rounded bg-[rgb(11,18,27)] border border-[rgb(36,52,70)] text-sm" />
              {price > 0 && (
                <input type="text" placeholder="USDC payment tx hash (0x…)"
                       value={txHash} onChange={e => setTxHash(e.target.value)}
                       className="w-full px-3 py-2 rounded bg-[rgb(11,18,27)] border border-[rgb(36,52,70)] text-sm font-mono" />
              )}
              {price > 0 && !txHash && (
                <div className="text-xs text-amber-300">
                  Pay {price} USDC on Base to {short(wallet)} and paste the tx hash above.
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setPicked(null)}
                        className="px-3 py-2 rounded text-sm border border-[rgb(36,52,70)]">
                  Back
                </button>
                <button type="button" onClick={handleConfirm} disabled={busy}
                        className="flex-1 px-3 py-2 rounded text-sm bg-[#ff6000] text-white font-semibold disabled:opacity-50">
                  {busy ? 'Confirming…' : 'Confirm booking'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtDay(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtDayLabel(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function short(addr) {
  return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '';
}
