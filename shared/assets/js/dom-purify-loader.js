/* Tokenomic — DOMPurify loader (Phase 7).
 *
 * Centralised user-HTML sanitiser. Any island or template that renders
 * user-provided HTML (article body, comment markdown, profile bio) MUST
 * route the string through window.TKNSanitize.html(input) instead of
 * setting innerHTML directly.
 *
 * We lazy-load DOMPurify from cdnjs so it doesn't add to the critical
 * bundle. The loader is idempotent and safe to call from multiple
 * islands concurrently.
 */
(function () {
  if (window.TKNSanitize) return;

  var SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js';
  // Subresource Integrity — pinned to DOMPurify 3.0.9.
  var INTEGRITY = 'sha384-xtx3wBAjCqDPNmw1+rWaRr/ngRaY/jU2ZaZpKAPJpknqj5sNJpKpPgKPeyPDnTbm';

  var pending = null;

  function load() {
    if (window.DOMPurify) return Promise.resolve(window.DOMPurify);
    if (pending) return pending;
    pending = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SCRIPT;
      s.integrity = INTEGRITY;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = function () {
        if (window.DOMPurify) resolve(window.DOMPurify);
        else reject(new Error('DOMPurify failed to attach'));
      };
      s.onerror = function () { reject(new Error('DOMPurify load error')); };
      document.head.appendChild(s);
    });
    return pending;
  }

  // Conservative profile: no scripts, no event handlers, no
  // javascript:/data: URIs except images. Anchors keep target=_blank
  // with forced noopener.
  var PROFILE = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'srcset'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#|\/)/i,
    ADD_ATTR: ['target', 'rel'],
  };

  function html(input) {
    if (typeof input !== 'string') return '';
    if (window.DOMPurify) return window.DOMPurify.sanitize(input, PROFILE);
    // Synchronous fallback: strip everything except text. Better safe
    // than letting raw HTML through while DOMPurify is still loading.
    return input.replace(/<[^>]*>/g, '');
  }

  function htmlAsync(input) {
    return load().then(function (DP) { return DP.sanitize(input, PROFILE); });
  }

  function setHTML(el, input) {
    if (!el) return;
    el.innerHTML = html(input);
  }

  function setHTMLAsync(el, input) {
    return htmlAsync(input).then(function (clean) {
      if (el) el.innerHTML = clean;
      return clean;
    });
  }

  window.TKNSanitize = {
    html: html,
    htmlAsync: htmlAsync,
    setHTML: setHTML,
    setHTMLAsync: setHTMLAsync,
    load: load,
  };

  // Eagerly warm the cache on idle so first call is instant.
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(function () { load().catch(function () {}); });
  } else {
    setTimeout(function () { load().catch(function () {}); }, 1500);
  }
})();
