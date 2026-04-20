(function () {
  'use strict';

  function ensureWallet() { return typeof TokenomicWallet !== 'undefined' ? TokenomicWallet : null; }
  function ensureAssets() { return typeof TokenomicAssets !== 'undefined' ? TokenomicAssets : null; }

  function setBtnState(btn, state, msg) {
    if (!btn) return;
    if (!btn.dataset._origHtml) btn.dataset._origHtml = btn.innerHTML;
    btn.classList.remove('is-loading', 'is-success', 'is-error');
    if (state === 'loading') {
      btn.classList.add('is-loading');
      btn.disabled = true;
      btn.innerHTML = '<span class="tkn-spinner" aria-hidden="true"></span> ' + (msg || 'Working...');
    } else if (state === 'success') {
      btn.classList.add('is-success');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> ' + (msg || 'Done');
      setTimeout(function () { resetBtn(btn); }, 4000);
    } else if (state === 'error') {
      btn.classList.add('is-error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i> ' + (msg || 'Try again');
      setTimeout(function () { resetBtn(btn); }, 4000);
    } else {
      resetBtn(btn);
    }
  }

  function resetBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('is-loading', 'is-success', 'is-error');
    if (btn.dataset._origHtml) btn.innerHTML = btn.dataset._origHtml;
  }

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'tkn-toast tkn-toast-' + (kind || 'info');
    t.innerHTML = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, kind === 'error' ? 6000 : 4000);
  }

  function explorerLink(txHash) {
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) return '';
    return '<a href="https://basescan.org/tx/' + txHash + '" target="_blank" rel="noopener">View on BaseScan <i class="fas fa-external-link-alt"></i></a>';
  }

  async function handleBuy(btn) {
    var assets = ensureAssets();
    var wallet = ensureWallet();
    if (!assets || !wallet) { toast('Web3 not loaded yet', 'error'); return; }

    var courseId = btn.getAttribute('data-course-id');
    var price = parseFloat(btn.getAttribute('data-price-usdc') || '0');
    var title = btn.getAttribute('data-course-title') || ('Course #' + courseId);

    if (!wallet.getAddress || !wallet.getAddress()) {
      setBtnState(btn, 'loading', 'Connecting...');
      try { await wallet.connectWallet(); } catch (e) {}
      if (!wallet.getAddress()) { setBtnState(btn, 'error', 'Connect wallet'); return; }
    }

    setBtnState(btn, 'loading', price > 0 ? 'Approving ' + price + ' USDC...' : 'Enrolling...');
    try {
      var res = await assets.buyCourse(courseId, price, { title: title });
      if (res && res.success) {
        setBtnState(btn, 'success', price > 0 ? 'Purchased' : 'Enrolled');
        var msg = price > 0
          ? 'Purchase complete! ' + explorerLink(res.txHash || '')
          : 'You are enrolled in <strong>' + escapeHtml(title) + '</strong>.';
        toast(msg, 'success');
        revealClaimButton(courseId);
      } else {
        setBtnState(btn, 'error', 'Failed');
      }
    } catch (e) {
      console.error('Buy failed:', e);
      setBtnState(btn, 'error', friendlyError(e));
      toast('Purchase failed: ' + (e && e.message ? escapeHtml(e.message) : 'Unknown error'), 'error');
    }
  }

  async function handleClaim(btn) {
    var assets = ensureAssets();
    var wallet = ensureWallet();
    if (!assets || !wallet) { toast('Web3 not loaded yet', 'error'); return; }

    var courseId = btn.getAttribute('data-course-id');
    var title = btn.getAttribute('data-course-title') || ('Course #' + courseId);

    if (!wallet.getAddress || !wallet.getAddress()) {
      setBtnState(btn, 'loading', 'Connecting...');
      try { await wallet.connectWallet(); } catch (e) {}
      if (!wallet.getAddress()) { setBtnState(btn, 'error', 'Connect wallet'); return; }
    }

    setBtnState(btn, 'loading', 'Minting NFT...');
    try {
      var res = await assets.claimCertificate(courseId, { title: title });
      if (res && res.success) {
        setBtnState(btn, 'success', 'Claimed');
        var msg = res.txHash
          ? 'Certificate minted! ' + explorerLink(res.txHash)
          : 'Certificate recorded' + (res.note ? ' &mdash; ' + escapeHtml(res.note) : '');
        toast(msg, 'success');
      } else {
        setBtnState(btn, 'error', 'Failed');
      }
    } catch (e) {
      console.error('Claim failed:', e);
      setBtnState(btn, 'error', friendlyError(e));
      toast('Claim failed: ' + (e && e.message ? escapeHtml(e.message) : 'Unknown error'), 'error');
    }
  }

  function friendlyError(e) {
    if (!e) return 'Error';
    var m = (e.message || '') + '';
    if (e.code === 4001 || /user (rejected|denied)/i.test(m)) return 'Rejected';
    if (/insufficient/i.test(m)) return 'Insufficient funds';
    if (/network|chain/i.test(m)) return 'Wrong network';
    return 'Try again';
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  function revealClaimButton(courseId) {
    document.querySelectorAll('[data-action="claim-cert"][data-course-id="' + courseId + '"]').forEach(function (b) {
      b.style.display = '';
    });
  }

  async function refreshOwnedState() {
    var assets = ensureAssets();
    if (!assets) return;
    try { await assets.loadAssets(); } catch (e) {}
    document.querySelectorAll('[data-course-id]').forEach(function (el) {
      var cid = el.getAttribute('data-course-id');
      var owned = assets.hasCourseAccess && assets.hasCourseAccess(cid);
      var action = el.getAttribute('data-action');
      if (owned && action === 'buy-course') {
        el.classList.add('is-success');
        el.disabled = true;
        if (!el.dataset._origHtml) el.dataset._origHtml = el.innerHTML;
        el.innerHTML = '<i class="fas fa-check"></i> Owned';
      }
      if (owned && action === 'claim-cert') {
        el.style.display = '';
      }
    });
  }

  function renderProfileWallet() {
    var slot = document.getElementById('tkn-wallet-summary');
    if (!slot) return;
    var wallet = ensureWallet();
    var assets = ensureAssets();
    var addr = wallet && wallet.getAddress && wallet.getAddress();
    if (!addr) {
      slot.innerHTML = '<button class="theme-btn btn-style-one tkn-wallet-connect-btn" type="button" data-action="connect-wallet" style="border-radius:8px;padding:10px 22px;font-size:0.9rem;"><i class="fas fa-wallet" style="margin-right:6px;"></i>Connect Wallet</button>';
      return;
    }
    slot.innerHTML =
      '<div class="tkn-wallet-card">' +
        '<div class="tkn-wallet-card-row">' +
          '<div><div class="tkn-wallet-label">Connected wallet</div>' +
          '<div class="tkn-wallet-addr"><i class="fas fa-circle" style="color:#00C853;font-size:0.55rem;margin-right:6px;"></i>' + escapeHtml(wallet.truncateAddress ? wallet.truncateAddress(addr) : addr) + '</div></div>' +
          '<a class="tkn-wallet-link" href="https://basescan.org/address/' + addr + '" target="_blank" rel="noopener">BaseScan <i class="fas fa-external-link-alt"></i></a>' +
        '</div>' +
        '<div class="tkn-wallet-card-row tkn-wallet-balances">' +
          '<div><div class="tkn-wallet-label">USDC</div><div class="tkn-wallet-amt" id="tkn-wallet-usdc">…</div></div>' +
          '<div><div class="tkn-wallet-label">ETH</div><div class="tkn-wallet-amt" id="tkn-wallet-eth">…</div></div>' +
          '<div><div class="tkn-wallet-label">Network</div><div class="tkn-wallet-amt">Base</div></div>' +
        '</div>' +
      '</div>';

    if (assets) {
      assets.getUSDCBalance().then(function (b) {
        var el = document.getElementById('tkn-wallet-usdc'); if (el) el.textContent = '$' + parseFloat(b).toFixed(2);
      }).catch(function () {});
      assets.getETHBalance().then(function (b) {
        var el = document.getElementById('tkn-wallet-eth'); if (el) el.textContent = b;
      }).catch(function () {});
    }

    renderMyCertificates();
  }

  function renderMyCertificates() {
    var slot = document.getElementById('tkn-my-certificates');
    if (!slot) return;
    var assets = ensureAssets();
    var wallet = ensureWallet();
    if (!assets) return;
    slot.innerHTML = '<div class="tkn-cert-loading">Loading certificates…</div>';

    var addr = wallet && wallet.getAddress && wallet.getAddress();

    // Prefer on-chain reads when the certificate contract is wired.
    if (addr && assets.CERT_NFT_ADDRESS && typeof assets.getOwnedCertificates === 'function') {
      assets.getOwnedCertificates(addr).then(function (certs) {
        if (!certs || certs.length === 0) {
          slot.innerHTML = '<div class="tkn-cert-empty"><i class="fas fa-certificate"></i><div>No certificates yet</div><small>Buy a course to receive your first on-chain certificate.</small></div>';
          return;
        }
        var html = '<div class="tkn-cert-grid">';
        certs.forEach(function (c) {
          html += '<div class="tkn-cert-card">' +
            '<div class="tkn-cert-icon"><i class="fas fa-certificate"></i></div>' +
            '<div class="tkn-cert-body">' +
              '<div class="tkn-cert-title">Certificate #' + escapeHtml(c.tokenId) + '</div>' +
              '<div class="tkn-cert-meta">Course ' + escapeHtml(c.courseId || '?') + (c.tokenURI ? ' · <a href="' + c.ipfsUrl + '" target="_blank" rel="noopener">metadata</a>' : '') + '</div>' +
              '<a href="' + c.explorerUrl + '" target="_blank" rel="noopener" class="tkn-cert-link">View on BaseScan <i class="fas fa-external-link-alt"></i></a>' +
            '</div></div>';
        });
        html += '</div>';
        slot.innerHTML = html;
      }).catch(function (err) {
        console.warn('On-chain cert load failed, falling back to legacy:', err);
        renderMyCertificatesLegacy(slot, assets);
      });
      return;
    }

    renderMyCertificatesLegacy(slot, assets);
  }

  function renderMyCertificatesLegacy(slot, assets) {
    assets.loadAssets().then(function (data) {
      var certs = (data && data.certifications) || [];
      if (certs.length === 0) {
        slot.innerHTML = '<div class="tkn-cert-empty"><i class="fas fa-certificate"></i><div>No certificates yet</div><small>Complete a course and click <em>Claim Certificate</em> to mint your first NFT.</small></div>';
        return;
      }
      var html = '<div class="tkn-cert-grid">';
      certs.forEach(function (c) {
        var tx = c.tx_hash || '';
        var link = tx ? '<a href="https://basescan.org/tx/' + tx + '" target="_blank" rel="noopener" class="tkn-cert-link">View on BaseScan <i class="fas fa-external-link-alt"></i></a>' : '<span class="tkn-cert-pending">Pending on-chain</span>';
        html += '<div class="tkn-cert-card">' +
          '<div class="tkn-cert-icon"><i class="fas fa-certificate"></i></div>' +
          '<div class="tkn-cert-body">' +
            '<div class="tkn-cert-title">' + escapeHtml(c.title || 'Certification') + '</div>' +
            '<div class="tkn-cert-meta">' + escapeHtml(c.description || '') + '</div>' +
            link +
          '</div></div>';
      });
      html += '</div>';
      slot.innerHTML = html;
    }).catch(function () {
      slot.innerHTML = '<div class="tkn-cert-empty">Could not load certificates.</div>';
    });
  }

  function injectStyles() {
    if (document.getElementById('tkn-web3-ui-styles')) return;
    var s = document.createElement('style');
    s.id = 'tkn-web3-ui-styles';
    s.textContent = [
      '.tkn-spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:tknspin 0.7s linear infinite;vertical-align:-2px;margin-right:6px}',
      '@keyframes tknspin{to{transform:rotate(360deg)}}',
      '.tkn-buy-btn,.tkn-claim-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;cursor:pointer;font-weight:600;font-size:0.82rem;padding:8px 14px;border-radius:8px;transition:all 0.18s ease;line-height:1}',
      '.tkn-buy-btn{background:#ff6000;color:#fff}',
      '.tkn-buy-btn:hover:not(:disabled){background:#e55400;transform:translateY(-1px);box-shadow:0 4px 12px rgba(255,96,0,0.3)}',
      '.tkn-claim-btn{background:transparent;color:#00C853;border:1.5px solid #00C853}',
      '.tkn-claim-btn:hover:not(:disabled){background:#00C853;color:#fff}',
      '.tkn-buy-btn.is-success,.tkn-claim-btn.is-success{background:#00C853;color:#fff;border-color:#00C853}',
      '.tkn-buy-btn.is-error,.tkn-claim-btn.is-error{background:#ef4444;color:#fff;border-color:#ef4444}',
      '.tkn-buy-btn:disabled,.tkn-claim-btn:disabled{cursor:wait;opacity:0.85}',
      '.tkn-card-actions{display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #f0f2f5;flex-wrap:wrap}',
      '.tkn-toast{position:fixed;bottom:24px;right:24px;background:#0A0F1A;color:#fff;padding:14px 20px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.25);max-width:380px;font-size:0.88rem;line-height:1.45;opacity:0;transform:translateY(12px);transition:all 0.28s ease;z-index:99999}',
      '.tkn-toast.show{opacity:1;transform:translateY(0)}',
      '.tkn-toast a{color:#ff9a4a;text-decoration:underline}',
      '.tkn-toast-success{border-left:4px solid #00C853}',
      '.tkn-toast-error{border-left:4px solid #ef4444}',
      '.tkn-wallet-card{background:linear-gradient(135deg,#0A0F1A 0%,#1a2138 100%);color:#fff;padding:18px 20px;border-radius:12px;margin-bottom:16px}',
      '.tkn-wallet-card-row{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap}',
      '.tkn-wallet-balances{margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08)}',
      '.tkn-wallet-balances>div{flex:1;min-width:90px}',
      '.tkn-wallet-label{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;opacity:0.65;margin-bottom:3px}',
      '.tkn-wallet-addr{font-family:monospace;font-size:0.95rem;font-weight:600}',
      '.tkn-wallet-amt{font-size:1.05rem;font-weight:700}',
      '.tkn-wallet-link{color:#ff9a4a;font-size:0.78rem;text-decoration:none}',
      '.tkn-wallet-link:hover{color:#ff6000}',
      '.tkn-cert-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}',
      '.tkn-cert-card{display:flex;gap:12px;background:#fff;border:1px solid #e8eef5;border-radius:10px;padding:14px}',
      '.tkn-cert-icon{width:40px;height:40px;border-radius:10px;background:rgba(0,200,83,0.1);color:#00C853;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}',
      '.tkn-cert-body{flex:1;min-width:0}',
      '.tkn-cert-title{font-weight:700;color:#0A0F1A;font-size:0.92rem;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tkn-cert-meta{color:#5a8299;font-size:0.78rem;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tkn-cert-link{color:#ff6000;font-size:0.76rem;text-decoration:none}',
      '.tkn-cert-pending{color:#5a8299;font-size:0.76rem;font-style:italic}',
      '.tkn-cert-empty{text-align:center;padding:30px 20px;color:#5a8299;font-size:0.88rem}',
      '.tkn-cert-empty i{font-size:2rem;color:#cbd5e1;display:block;margin-bottom:10px}',
      '.tkn-cert-empty small{display:block;margin-top:6px;font-size:0.78rem;opacity:0.85}',
      '.tkn-cert-loading{text-align:center;padding:24px;color:#5a8299;font-size:0.88rem}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function bindGlobalDelegate() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-action]');
      if (!b) return;
      var a = b.getAttribute('data-action');
      if (a === 'buy-course') { e.preventDefault(); handleBuy(b); }
      else if (a === 'claim-cert') { e.preventDefault(); handleClaim(b); }
      else if (a === 'connect-wallet') {
        e.preventDefault();
        var w = ensureWallet();
        if (w) w.connectWallet().then(function () { renderProfileWallet(); refreshOwnedState(); });
      }
    });
  }

  function init() {
    injectStyles();
    bindGlobalDelegate();
    renderProfileWallet();
    setTimeout(refreshOwnedState, 600);

    var w = ensureWallet();
    if (w && !w._tknUiHooked) {
      w._tknUiHooked = true;
      var orig = w.updateUI && w.updateUI.bind(w);
      w.updateUI = function () {
        if (orig) orig();
        renderProfileWallet();
        refreshOwnedState();
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TokenomicUI = {
    refresh: function () { renderProfileWallet(); refreshOwnedState(); },
    renderMyCertificates: renderMyCertificates,
    toast: toast
  };
})();
