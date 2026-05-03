/* Header wallet-button bootstrap (Phase 7 / strict CSP).
 *
 * Replaces the inline onclick="TokenomicWallet.X()" handlers that
 * used to live in _includes/header.html. Each interactive element
 * now carries data-tkn-action="…" and this script wires the click.
 *
 * The behavior is identical to the previous handlers; we just route
 * through addEventListener so script-src can stay strict.
 */
(function () {
  function withEvent(action) {
    return function (e) {
      e.preventDefault();
      var TW = window.TokenomicWallet;
      if (!TW) return false;
      switch (action) {
        case 'connect':            if (TW.connect) TW.connect(); break;
        case 'disconnect':         if (TW.disconnect) TW.disconnect(); break;
        case 'toggle-account':     if (TW.toggleAccountDropdown) TW.toggleAccountDropdown(e); break;
        case 'switch-base':        if (TW.switchToNetwork) TW.switchToNetwork('base'); break;
        case 'switch-base-sepolia':if (TW.switchToNetwork) TW.switchToNetwork('base-sepolia'); break;
      }
      return false;
    };
  }
  function callIfFn(name, arg) {
    if (typeof window[name] === 'function') window[name](arg);
  }
  function wireDashboardLegacy() {
    // File-picker triggers: data-tkn-action="picker:<input-id>"
    document.querySelectorAll('[data-tkn-action^="picker:"]').forEach(function (el) {
      if (el.dataset.tknBound === '1') return;
      el.dataset.tknBound = '1';
      var id = el.getAttribute('data-tkn-action').slice(7);
      el.addEventListener('click', function () {
        var input = document.getElementById(id);
        if (input) input.click();
      });
    });
    // Drag-zone visual state: data-tkn-dz="over" / "leave"
    document.querySelectorAll('[data-tkn-dz]').forEach(function (el) {
      if (el.dataset.tknDzBound === '1') return;
      el.dataset.tknDzBound = '1';
      var mode = el.getAttribute('data-tkn-dz');
      if (mode === 'over') {
        el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('drag-over'); });
      } else if (mode === 'leave') {
        el.addEventListener('dragleave', function () { el.classList.remove('drag-over'); });
      }
    });
    // drop:* handlers route to legacy globals.
    var dropMap = {
      'drop:nc-thumb': 'handleNcThumbDrop',
      'drop:edit-thumb': 'handleEditThumbDrop',
      'drop:media': 'handleMediaDrop',
    };
    Object.keys(dropMap).forEach(function (key) {
      document.querySelectorAll('[data-tkn-action="' + key + '"]').forEach(function (el) {
        if (el.dataset.tknDropBound === '1') return;
        el.dataset.tknDropBound = '1';
        el.addEventListener('drop', function (e) { callIfFn(dropMap[key], e); });
      });
    });
    // filechg:* handlers route to legacy globals (file inputs, change event).
    var chgMap = {
      'filechg:nc-thumb': 'handleNcThumbSelect',
      'filechg:edit-thumb': 'handleEditThumbSelect',
      'filechg:media': 'handleMediaSelect',
      'avatar-file-select': 'handleAvatarFileSelect',
    };
    Object.keys(chgMap).forEach(function (key) {
      document.querySelectorAll('[data-tkn-action="' + key + '"]').forEach(function (el) {
        if (el.dataset.tknChgBound === '1') return;
        el.dataset.tknChgBound = '1';
        el.addEventListener('change', function (e) { callIfFn(chgMap[key], e); });
      });
    });
    // Profile / dashboard click-to-call mappings.
    var clickMap = {
      'avatar-pick': function () { var i = document.getElementById('avatar-file-input'); if (i) i.click(); },
      'avatar-dragover': function (e) { callIfFn('handleAvatarDragOver', e); },
      'avatar-dragleave': function (e) { callIfFn('handleAvatarDragLeave', e); },
      'avatar-drop': function (e) { callIfFn('handleAvatarDrop', e); },
      'ui-refresh': function () { if (window.TokenomicUI && window.TokenomicUI.refresh) window.TokenomicUI.refresh(); },
      'prove-ownership': function () { callIfFn('proveOwnership'); },
      'tokenize-asset': function () { callIfFn('tokenizeAssetAction'); },
      'claim-revenue': function () { callIfFn('claimRevenueAction'); },
      'register-article': function () { callIfFn('registerArticleAction'); },
      'mint-cert': function () { callIfFn('mintCertAction'); },
      'newsletter-submit': function (e) { if (e && e.preventDefault) e.preventDefault(); callIfFn('submitNewsletter', e); return false; },
    };
    Object.keys(clickMap).forEach(function (key) {
      document.querySelectorAll('[data-tkn-action="' + key + '"]').forEach(function (el) {
        if (el.dataset.tknClkBound === '1') return;
        el.dataset.tknClkBound = '1';
        // newsletter-submit lives on a <form>, all others on clickable elements.
        var ev = key === 'newsletter-submit' ? 'submit'
               : (key === 'avatar-dragover' ? 'dragover'
               : (key === 'avatar-dragleave' ? 'dragleave'
               : (key === 'avatar-drop' ? 'drop' : 'click')));
        el.addEventListener(ev, clickMap[key]);
      });
    });
  }
  function wireFaq() {
    document.querySelectorAll('[data-tkn-toggle="faq"]').forEach(function (el) {
      if (el.dataset.tknBound === '1') return;
      el.dataset.tknBound = '1';
      el.addEventListener('click', function () { el.classList.toggle('open'); });
    });
  }
  function wireArticleActions() {
    var copyBtn = document.querySelector('[data-tkn-action="copy-article-link"]');
    if (copyBtn && copyBtn.dataset.tknBound !== '1') {
      copyBtn.dataset.tknBound = '1';
      copyBtn.addEventListener('click', function () {
        if (typeof window.copyArticleLink === 'function') window.copyArticleLink(copyBtn);
      });
    }
    var submitBtn = document.querySelector('[data-tkn-action="submit-article-comment"]');
    if (submitBtn && submitBtn.dataset.tknBound !== '1') {
      submitBtn.dataset.tknBound = '1';
      submitBtn.addEventListener('click', function () {
        if (typeof window.submitArticleComment === 'function') window.submitArticleComment();
      });
    }
  }
  function wire() {
    document.querySelectorAll('[data-tkn-action]').forEach(function (el) {
      if (el.dataset.tknBound === '1') return;
      var action = el.getAttribute('data-tkn-action');
      // Article actions are handled separately (different signature).
      if (action === 'copy-article-link' || action === 'submit-article-comment') return;
      el.dataset.tknBound = '1';
      el.addEventListener('click', withEvent(action));
    });
    wireFaq();
    wireArticleActions();
    wireDashboardLegacy();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
  // Expose so dynamic markup (mobile menu cloned by jQuery plugins)
  // can re-run the wiring after it appears.
  window.TKNHeaderRewire = wire;
})();
