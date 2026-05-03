/* Extracted from dashboard/referrals.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
window.onTurnstileVerified = function(token) {
  var roots = document.querySelectorAll('[x-data^="referralsPage"]');
  roots.forEach(function(r) { if (r.__x && r.__x.$data) r.__x.$data.turnstileToken = token; });
};

function referralsPage() {
  var API = (window.TOKENOMIC_API_BASE || (window.__TKN_ENV && window.__TKN_ENV.API_BASE) || '').replace(/\/+$/, '');
  return {
    MAX_RECIPIENTS: 50,
    me: { link: '', signups: 0, qualified: 0, paid: 0, usdc_earned: 0, recent: [] },
    source: 'csv',
    contacts: [],          // [{ name, email, selected, bad? }]
    dragOver: false,
    loading: false,
    loadError: '',
    sending: false,
    sendResult: '',
    copied: false,
    personalMessage: '',
    turnstileSiteKey: (window.__TKN_ENV && window.__TKN_ENV.TURNSTILE_SITE_KEY) || '',
    turnstileToken: '',
    linking: false,
    linkingStep: '',
    linkError: '',

    async init() {
      try {
        var jwt = localStorage.getItem('tkn-jwt') || localStorage.getItem('jwt') || '';
        var headers = { 'accept': 'application/json' };
        if (jwt && jwt !== 'null') headers['authorization'] = 'Bearer ' + jwt;
        var r = await fetch(API + '/api/referrals/me', { headers: headers, credentials: 'include' });
        if (r.ok) this.me = await r.json();
      } catch (e) { console.warn('referrals/me failed', e); }
    },

    async confirmReferrerOnChain() {
      this.linkError = '';
      const pl = this.me && this.me.pending_link;
      if (!pl || !pl.referrer || !pl.registry) {
        this.linkError = 'No pending link to confirm.';
        return;
      }
      if (!window.ethereum) {
        this.linkError = 'No injected wallet detected. Connect a wallet (MetaMask, Rabby, Coinbase) and retry.';
        return;
      }
      this.linking = true;
      try {
        // Switch chain if needed.
        const wantChainHex = '0x' + Number(pl.chain_id).toString(16);
        try {
          this.linkingStep = 'Switching chain…';
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: wantChainHex }] });
        } catch (e) {
          if (e && e.code === 4902) {
            this.linkError = 'Add Base to your wallet first, then retry.';
            this.linking = false; return;
          }
          // Other errors (user already on chain, etc.) can be ignored.
        }
        // Encode setReferrer(address) selector + 32-byte arg.
        const selector = '0xa18a7bfc'; // keccak256("setReferrer(address)").slice(0,10)
        const arg = pl.referrer.toLowerCase().replace(/^0x/, '').padStart(64, '0');
        const data = selector + arg;
        this.linkingStep = 'Awaiting signature…';
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const from = (accounts && accounts[0]) || '';
        const txHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{ from, to: pl.registry, data, value: '0x0' }],
        });
        this.linkingStep = 'Confirming…';
        var jwt = localStorage.getItem('tkn-jwt') || localStorage.getItem('jwt') || '';
        var headers = { 'content-type': 'application/json', 'accept': 'application/json' };
        if (jwt && jwt !== 'null') headers['authorization'] = 'Bearer ' + jwt;
        const r = await fetch(API + '/api/referrals/confirm-link', {
          method: 'POST', headers, credentials: 'include',
          body: JSON.stringify({ txHash }),
        });
        const data2 = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data2.error || ('HTTP ' + r.status));
        // Re-fetch /me — pending_link will clear and `linked` count will bump.
        await this.init();
      } catch (e) {
        this.linkError = e.message || String(e);
      } finally {
        this.linking = false;
        this.linkingStep = '';
      }
    },

    copyLink() {
      if (!this.me.link) return;
      navigator.clipboard.writeText(this.me.link).then(() => {
        this.copied = true;
        setTimeout(() => this.copied = false, 2000);
      });
    },

    selectedCount() { return this.contacts.filter(c => c.selected && !c.bad).length; },
    selectAll(v) { this.contacts.forEach(c => { if (!c.bad) c.selected = v; }); },

    handleFile(file) {
      if (!file) return;
      this.source = 'csv';
      this.loadError = '';
      var reader = new FileReader();
      reader.onload = (e) => {
        try { this.parseCsv(String(e.target.result || '')); }
        catch (err) { this.loadError = 'Could not parse CSV: ' + err.message; }
      };
      reader.readAsText(file);
    },

    parseCsv(text) {
      // Minimal CSV: header line + comma-separated rows. Quoted fields supported.
      var lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
      if (!lines.length) throw new Error('Empty file');
      var header = this.splitCsvRow(lines[0]).map(h => h.toLowerCase().trim());
      var emailIdx = header.indexOf('email');
      var nameIdx  = header.indexOf('name');
      if (emailIdx < 0) {
        // Single-column file? Treat as bare emails.
        emailIdx = 0;
        nameIdx = -1;
        lines.unshift('email');
      }
      var seen = new Set();
      var out = [];
      for (var i = 1; i < lines.length; i++) {
        var row = this.splitCsvRow(lines[i]);
        var email = (row[emailIdx] || '').trim().toLowerCase();
        var name  = nameIdx >= 0 ? (row[nameIdx] || '').trim() : '';
        if (!email) continue;
        if (seen.has(email)) continue;
        seen.add(email);
        var bad = '';
        if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-zA-Z]{2,}$/.test(email)) bad = 'invalid';
        out.push({ email: email, name: name, selected: !bad, bad: bad });
        if (out.length >= 500) break;
      }
      this.contacts = out;
    },

    splitCsvRow(line) {
      var out = []; var cur = ''; var q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) {
          if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { q = false; }
          else { cur += ch; }
        } else {
          if (ch === ',') { out.push(cur); cur = ''; }
          else if (ch === '"') { q = true; }
          else { cur += ch; }
        }
      }
      out.push(cur);
      return out;
    },

    async loadGoogle() {
      this.source = 'google';
      this.loading = true; this.loadError = '';
      try {
        var jwt = localStorage.getItem('tkn-jwt') || localStorage.getItem('jwt') || '';
        var r = await fetch(API + '/api/referrals/google-contacts', {
          headers: jwt && jwt !== 'null' ? { 'authorization': 'Bearer ' + jwt } : {},
          credentials: 'include',
        });
        var data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        this.contacts = (data.contacts || []).map(c => ({ ...c, selected: true, bad: '' }));
        if (!this.contacts.length) this.loadError = 'No contacts found in your Google account.';
      } catch (e) {
        this.loadError = 'Google import failed: ' + e.message + '. Make sure you have connected Google Calendar in Profile → Calendar Integrations (the same OAuth grants Contacts access).';
      } finally { this.loading = false; }
    },

    async loadMicrosoft() {
      this.source = 'microsoft';
      this.loading = true; this.loadError = '';
      try {
        var jwt = localStorage.getItem('tkn-jwt') || localStorage.getItem('jwt') || '';
        var r = await fetch(API + '/api/referrals/microsoft-contacts', {
          headers: jwt && jwt !== 'null' ? { 'authorization': 'Bearer ' + jwt } : {},
          credentials: 'include',
        });
        var data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        this.contacts = (data.contacts || []).map(c => ({ ...c, selected: true, bad: '' }));
        if (!this.contacts.length) this.loadError = 'No contacts found in your Microsoft account.';
      } catch (e) {
        this.loadError = 'Outlook import failed: ' + e.message + '. Connect Microsoft in Profile → Calendar Integrations first.';
      } finally { this.loading = false; }
    },

    async send() {
      var picked = this.contacts.filter(c => c.selected && !c.bad).slice(0, this.MAX_RECIPIENTS);
      if (picked.length === 0) { this.sendResult = 'Nothing to send.'; return; }
      if (this.turnstileSiteKey && !this.turnstileToken) { this.sendResult = 'Complete the Turnstile challenge first.'; return; }
      this.sending = true; this.sendResult = '';
      try {
        var jwt = localStorage.getItem('tkn-jwt') || localStorage.getItem('jwt') || '';
        var headers = { 'content-type': 'application/json', 'accept': 'application/json' };
        if (jwt && jwt !== 'null') headers['authorization'] = 'Bearer ' + jwt;
        var r = await fetch(API + '/api/referrals/invite-batch', {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({
            recipients: picked.map(c => ({ email: c.email, name: c.name })),
            message: this.personalMessage,
            source: this.source,
            turnstileToken: this.turnstileToken,
          }),
        });
        var data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        var s = data.summary || {};
        this.sendResult = `Sent ${s.sent || 0} • duplicate ${s.duplicate || 0} • suppressed ${s.suppressed || 0} • failed ${s.failed || 0}`;
        // Reset turnstile (one-time use)
        this.turnstileToken = '';
        if (window.turnstile && window.turnstile.reset) try { window.turnstile.reset(); } catch (_) {}
      } catch (e) {
        this.sendResult = 'Send failed: ' + e.message;
      } finally { this.sending = false; }
    },
  };
}
