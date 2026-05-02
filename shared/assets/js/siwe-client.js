/**
 * Phase 0 — SIWE (cookie-session) client helper.
 *
 * Drop-in companion to d1-client.js. Where d1-client uses the legacy
 * /api/auth/login + Bearer JWT path, this helper drives the SIWE flow that
 * sets an HTTP-only `tk_session` cookie on the api-worker domain so SSR
 * Workers can authenticate the visitor without round-tripping through
 * localStorage.
 *
 *   await TokenomicSiwe.signIn();   // prompts wallet, returns address
 *   await TokenomicSiwe.me();        // {address, exp} | null
 *   await TokenomicSiwe.signOut();
 *
 * Requires window.TokenomicWeb3 (web3-bundle.js) and an active wallet
 * connection — call TokenomicWallet.connect() first if needed.
 */

(function () {
  var API_BASE = (window.TOKENOMIC_API_BASE ||
    'https://tokenomic-api.guillaumelauzier.workers.dev').replace(/\/+$/, '');

  function lc(s) { return (s || '').toString().toLowerCase(); }

  function buildMessage(opts) {
    // Server enforces an exact domain match against SIWE_DOMAIN (or any of the
    // hosts in SIWE_DOMAINS). To avoid a mismatch when a user visits
    // www.tokenomic.org while the worker expects tokenomic.org, we let the
    // page override via window.TOKENOMIC_SIWE_DOMAIN. Default to the canonical
    // production host so the message is verifiable even from preview origins.
    var domain = opts.domain || window.TOKENOMIC_SIWE_DOMAIN || 'tokenomic.org';
    var uri = opts.uri || window.location.origin || ('https://' + domain);
    var statement = opts.statement ||
      'Sign in to Tokenomic. This signature does not authorize any transaction or fee.';
    return [
      domain + ' wants you to sign in with your Ethereum account:',
      opts.address,
      '',
      statement,
      '',
      'URI: ' + uri,
      'Version: 1',
      'Chain ID: ' + (opts.chainId || 8453),
      'Nonce: ' + opts.nonce,
      'Issued At: ' + new Date().toISOString(),
    ].join('\n');
  }

  async function fetchJson(method, path, body) {
    var res = await fetch(API_BASE + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'include',                           // cookies
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  var TokenomicSiwe = {
    base: API_BASE,

    async nonce() {
      var r = await fetchJson('GET', '/api/siwe/nonce');
      return r.nonce;
    },

    async me() {
      try { return await fetchJson('GET', '/api/siwe/me'); }
      catch (e) { if (e.status === 401) return null; throw e; }
    },

    async signOut() {
      try { await fetchJson('POST', '/api/siwe/logout'); }
      catch (_) { /* swallow */ }
    },

    /**
     * Run the full nonce -> personal_sign -> verify flow. Returns {address, exp}.
     */
    async signIn(opts) {
      opts = opts || {};
      var W = window.TokenomicWeb3;
      if (!W) throw new Error('Web3 stack not loaded — include web3-bundle.js');

      var account = W.getAccount();
      var address = (account && account.address) || (window.TokenomicWallet && window.TokenomicWallet.account) || null;
      if (!address) {
        if (window.TokenomicWallet && typeof window.TokenomicWallet.connect === 'function') {
          await window.TokenomicWallet.connect();
          account = W.getAccount();
          address = (account && account.address) || window.TokenomicWallet.account;
        }
      }
      if (!address) throw new Error('No wallet connected');

      var chainId = (account && account.chainId) || (W.chains.base && W.chains.base.id) || 8453;
      var nonce = await this.nonce();
      var message = buildMessage({
        address: address,
        nonce: nonce,
        chainId: chainId,
        domain: opts.domain,
        uri: opts.uri,
        statement: opts.statement,
      });

      var signature;
      try {
        signature = await W.signMessage({ account: address, message: message });
      } catch (e) {
        // Fallback to legacy path for raw-injected providers that did not go
        // through wagmi (TokenomicWallet.connectWithProvider('metamask'/etc.)).
        if (window.ethereum && window.ethereum.request) {
          signature = await window.ethereum.request({
            method: 'personal_sign', params: [message, address],
          });
        } else { throw e; }
      }

      var verify = await fetchJson('POST', '/api/siwe/verify', {
        address: lc(address), message: message, signature: signature,
      });
      return verify;
    },
  };

  if (typeof window !== 'undefined') {
    window.TokenomicSiwe = TokenomicSiwe;
  }
})();
