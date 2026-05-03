/**
 * alerts.js — Phase 7 error-spike alerter.
 *
 * Wired into wrangler.toml as a Cron Trigger ("*\/5 * * * *"). On each
 * tick we query Workers Analytics Engine for the last 5 minutes of
 * 5xx-class responses and compare to a configurable threshold. When
 * the threshold is breached we send a single email via MailChannels to
 * `OPS_ALERT_EMAIL` and stash a debounce key in KV so the same spike
 * doesn't re-page every 5 minutes.
 *
 * Intentionally pull-based (Cron + AE SQL) rather than push-based:
 *  - Workers Analytics Engine has no native alerting, and pushing from
 *    the per-request middleware would require an in-memory counter that
 *    doesn't survive isolate eviction.
 *  - Cron triggers run in a separate isolate so a request flood doesn't
 *    delay the alerter.
 *
 * Required env (degrades to no-op if any are missing):
 *   ANALYTICS_ENGINE_DATASET   AE dataset name (also used by /admin/observability)
 *   CF_ACCOUNT_ID              Cloudflare account id
 *   CF_API_TOKEN               Account-scoped token with AE read scope
 *   OPS_ALERT_EMAIL            Where to send the alert
 *   ALERT_THRESHOLD_5XX_5M     Optional — 5xx count above which we page (default 25)
 *   RATE_LIMIT_KV              KV namespace used for debounce
 */

const DEFAULT_THRESHOLD = 25;
const DEBOUNCE_KEY      = 'alerts:5xx:debounce';
const DEBOUNCE_TTL_SEC  = 30 * 60; // suppress re-pages for 30 minutes

async function aeRead(env, sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: sql,
  });
  if (!r.ok) throw new Error(`AE query failed: HTTP ${r.status}`);
  return r.json();
}

async function sendEmail(env, subject, body) {
  // MailChannels (the same path Phase 5 uses for invites). DKIM signing
  // is handled by Cloudflare's outbound config — we don't repeat it here.
  const from = env.MAIL_FROM || 'alerts@tokenomic.org';
  const r = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: env.OPS_ALERT_EMAIL }] }],
      from: { email: from, name: 'Tokenomic Alerts' },
      subject,
      content: [{ type: 'text/plain', value: body }],
    }),
  });
  if (!r.ok) throw new Error(`MailChannels failed: HTTP ${r.status}`);
}

export async function checkErrorSpikes(env, ctx) {
  // Hard-required config; no-op if any missing.
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN ||
      !env.ANALYTICS_ENGINE_DATASET || !env.OPS_ALERT_EMAIL) {
    return { skipped: 'config-missing' };
  }
  // Debounce — never page twice for the same incident.
  if (env.RATE_LIMIT_KV) {
    const seen = await env.RATE_LIMIT_KV.get(DEBOUNCE_KEY);
    if (seen) return { skipped: 'debounced', until: seen };
  }
  const threshold = Number(env.ALERT_THRESHOLD_5XX_5M) || DEFAULT_THRESHOLD;
  const sql = `
    SELECT
      SUM(IF(double2 >= 500, _sample_interval, 0)) AS errors_5xx,
      SUM(_sample_interval)                         AS total
    FROM ${env.ANALYTICS_ENGINE_DATASET}
    WHERE timestamp >= NOW() - INTERVAL '5' MINUTE
  `;
  let result;
  try {
    result = await aeRead(env, sql);
  } catch (e) {
    // If AE itself is failing, we can't tell if there's a spike. Stay
    // silent rather than spamming — this is the alerter's own fault.
    return { skipped: 'ae-unavailable', error: e.message };
  }
  const row = (result && result.data && result.data[0]) || {};
  const errors = Number(row.errors_5xx || 0);
  const total  = Number(row.total || 0);
  if (errors < threshold) {
    return { ok: true, errors, total, fired: false };
  }
  const subject = `[Tokenomic] 5xx spike: ${errors} errors in last 5 minutes`;
  const body =
    `5xx count over the last 5 minutes: ${errors}\n` +
    `Total requests:                    ${total}\n` +
    `Threshold:                         ${threshold}\n\n` +
    `Investigate at https://tokenomic.org/dashboard/admin/observability/?window=15m\n`;
  try {
    await sendEmail(env, subject, body);
    if (env.RATE_LIMIT_KV) {
      ctx.waitUntil(env.RATE_LIMIT_KV.put(
        DEBOUNCE_KEY,
        new Date().toISOString(),
        { expirationTtl: DEBOUNCE_TTL_SEC },
      ));
    }
    return { ok: true, errors, total, fired: true };
  } catch (e) {
    return { ok: false, errors, total, error: e.message };
  }
}
