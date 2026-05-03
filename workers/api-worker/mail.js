/**
 * MailChannels transactional email helper (Phase 6).
 *
 * Generalized version of sendInviteEmail() previously living in
 * referrals.js. Sends one message via MailChannels' free SMTP relay
 * for Cloudflare Workers, optionally signed with DKIM (required so the
 * recipient's MTA does not bounce the message — MailChannels enforces
 * SPF or DKIM).
 *
 * Required env (production):
 *   MAIL_FROM                e.g. "Tokenomic <hello@tokenomic.org>"
 *   MAIL_FROM_DOMAIN         "tokenomic.org"
 *   MAILCHANNELS_DKIM_SELECTOR     e.g. "mailchannels"
 *   MAILCHANNELS_DKIM_PRIVATE_KEY  base64 PKCS#8 RSA private key
 *
 * Legacy `MAIL_DKIM_SELECTOR` / `MAIL_DKIM_PRIVATE_KEY` are still
 * accepted as a fallback to avoid breaking existing deployments.
 *
 * The helper degrades gracefully when these are missing: returns
 * { ok: false, error: 'mail-not-configured' } and the caller logs the
 * attempt to email_log so the dashboard can surface it.
 */


function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

/**
 * sendEmail — POST to MailChannels.
 *
 *   env       worker bindings
 *   opts.to            string email or { email, name }
 *   opts.subject       string
 *   opts.html          rendered HTML body
 *   opts.text          plain-text body (recommended; some clients block HTML)
 *   opts.from          override of MAIL_FROM (string "Name <addr>" or { email, name })
 *   opts.replyTo       optional reply-to address
 *   opts.headers       additional headers map (e.g. List-Unsubscribe)
 *   opts.attachments   [{ filename, content, type }] — content is base64 string
 */
export async function sendEmail(env, opts) {
  if (!opts || !opts.to || !opts.subject || (!opts.html && !opts.text)) {
    return { ok: false, error: 'mail-bad-arguments' };
  }
  const recipientEmail = typeof opts.to === 'string' ? opts.to : (opts.to && opts.to.email);
  const recipientName  = typeof opts.to === 'object' ? opts.to.name : undefined;
  if (!isValidEmail(recipientEmail)) return { ok: false, error: 'mail-invalid-recipient' };

  // Parse MAIL_FROM "Display Name <addr@domain>"
  const fromRaw = opts.from || env.MAIL_FROM || `Tokenomic <noreply@${env.MAIL_FROM_DOMAIN || 'tokenomic.org'}>`;
  let fromEmail, fromName;
  if (typeof fromRaw === 'object') {
    fromEmail = fromRaw.email; fromName = fromRaw.name;
  } else {
    const m = String(fromRaw).match(/^\s*(?:"?([^"<]*?)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?\s*$/);
    if (m) { fromName = (m[1] || '').trim() || undefined; fromEmail = m[2]; }
  }
  if (!isValidEmail(fromEmail)) return { ok: false, error: 'mail-invalid-from' };

  const dkimDomain = env.MAIL_FROM_DOMAIN || (fromEmail.split('@')[1] || 'tokenomic.org');
  const dkimKey = env.MAILCHANNELS_DKIM_PRIVATE_KEY || env.MAIL_DKIM_PRIVATE_KEY;
  const dkimSel = env.MAILCHANNELS_DKIM_SELECTOR || env.MAIL_DKIM_SELECTOR || 'mailchannels';
  const dkim = dkimKey ? {
    dkim_domain:      dkimDomain,
    dkim_selector:    dkimSel,
    dkim_private_key: dkimKey,
  } : null;

  // Without DKIM AND without the SPF chain set up at the recipient's side,
  // MailChannels will reject the send. We still attempt — the error is
  // logged so an operator can fix DNS.
  const personalization = {
    to: [{ email: recipientEmail, name: recipientName || undefined }],
    ...(dkim || {}),
  };

  const content = [];
  if (opts.text) content.push({ type: 'text/plain', value: String(opts.text) });
  if (opts.html) content.push({ type: 'text/html',  value: String(opts.html) });

  const payload = {
    personalizations: [personalization],
    from: { email: fromEmail, name: fromName },
    subject: String(opts.subject).slice(0, 200),
    content,
  };
  if (opts.replyTo && isValidEmail(opts.replyTo)) {
    payload.reply_to = { email: opts.replyTo };
  }
  if (opts.headers && typeof opts.headers === 'object') {
    payload.headers = {};
    for (const k of Object.keys(opts.headers)) {
      const v = opts.headers[k];
      if (typeof v === 'string' && v.length < 1000) payload.headers[k] = v;
    }
  }
  if (Array.isArray(opts.attachments) && opts.attachments.length) {
    payload.attachments = opts.attachments
      .filter(a => a && a.filename && a.content)
      .slice(0, 10)
      .map(a => ({
        filename: String(a.filename).slice(0, 255),
        content:  String(a.content),
        type:     a.type || 'application/octet-stream',
        disposition: 'attachment',
      }));
  }

  try {
    const r = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (r.status === 202 || r.ok) {
      const messageId = r.headers.get('x-message-id') || null;
      return { ok: true, message_id: messageId };
    }
    const err = await r.text().catch(() => '');
    return { ok: false, error: `mailchannels ${r.status}: ${err.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: 'mailchannels-network-error: ' + (e && e.message) };
  }
}

/**
 * Persist an email send attempt to D1's email_log so the dashboard /
 * support tooling has an audit trail. Best-effort; failures don't block.
 */
export async function logEmail(env, { recipient, template, subject, status, error, message_id, meta }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT INTO email_log (recipient, template, subject, status, error, message_id, meta, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      String(recipient || '').slice(0, 254),
      String(template  || '').slice(0, 60),
      subject ? String(subject).slice(0, 200) : null,
      status || 'queued',
      error  ? String(error).slice(0, 500) : null,
      message_id || null,
      meta ? JSON.stringify(meta).slice(0, 4000) : null,
      status === 'sent' ? new Date().toISOString() : null,
    ).run();
  } catch (_) { /* swallow */ }
}

// ─────────────────────────────────────────────── Templates

const FOOTER = `<hr style="border:none;border-top:1px solid #e8eef5;margin:32px 0 16px"><p style="color:#5a8299;font-size:12px;margin:0">Tokenomic — On-chain learning on Base. <a href="https://tokenomic.org" style="color:#ff6000">tokenomic.org</a></p>`;

export function tplEnrollmentConfirmation({ courseTitle, courseSlug, learnerName }) {
  const link = `https://tokenomic.org/course/?slug=${encodeURIComponent(courseSlug)}`;
  const subject = `You're enrolled in “${courseTitle}”`;
  const text =
`Welcome${learnerName ? ', ' + learnerName : ''}!

Your enrollment in "${courseTitle}" is confirmed. Open the course at:
${link}

— Tokenomic`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0A0F1A">
    <h2 style="color:#0A0F1A;margin:0 0 12px">You're enrolled${learnerName ? ', ' + escHtml(learnerName) : ''}!</h2>
    <p>Your enrollment in <strong>${escHtml(courseTitle)}</strong> is confirmed. The on-chain access NFT was minted to your wallet on Base.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#ff6000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open course →</a></p>
    ${FOOTER}
  </div>`;
  return { subject, text, html };
}

export function tplCertificateIssued({ courseTitle, learnerName, pdfUrl, txHash }) {
  const subject = `Your certificate for “${courseTitle}” is ready`;
  const text =
`Congratulations${learnerName ? ', ' + learnerName : ''}!

You finished "${courseTitle}". Download your signed PDF certificate:
${pdfUrl}

${txHash ? 'On-chain mint: https://basescan.org/tx/' + txHash : ''}

— Tokenomic`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0A0F1A">
    <h2 style="color:#0A0F1A;margin:0 0 12px">🎓 Certificate ready</h2>
    <p>Congratulations${learnerName ? ', ' + escHtml(learnerName) : ''}! You completed <strong>${escHtml(courseTitle)}</strong>.</p>
    <p style="margin:24px 0"><a href="${escHtml(pdfUrl)}" style="background:#00C853;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Download PDF certificate →</a></p>
    ${txHash ? `<p style="font-size:13px;color:#5a8299">On-chain mint: <a href="https://basescan.org/tx/${escHtml(txHash)}" style="color:#ff6000">${escHtml(txHash.slice(0,10))}…</a></p>` : ''}
    ${FOOTER}
  </div>`;
  return { subject, text, html };
}

export function tplCoursePublished({ courseTitle, courseSlug, educatorName }) {
  const link = `https://tokenomic.org/course/?slug=${encodeURIComponent(courseSlug)}`;
  const subject = `“${courseTitle}” is live on Tokenomic`;
  const text =
`Your course "${courseTitle}" was approved and is now live at:
${link}

Share the link with your community to start enrollments.

— Tokenomic`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0A0F1A">
    <h2 style="color:#0A0F1A;margin:0 0 12px">Your course is live!</h2>
    <p>${educatorName ? escHtml(educatorName) + ', y' : 'Y'}our course <strong>${escHtml(courseTitle)}</strong> was approved and is now discoverable on Tokenomic.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#ff6000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">View public page →</a></p>
    ${FOOTER}
  </div>`;
  return { subject, text, html };
}
