/* Tokenomic — i18n runtime built on i18next (Phase 7).
 *
 * Loads i18next + the EN/TR/ES catalogs at first paint. Public surface
 * is intentionally small and identical to the previous hand-rolled
 * shim so footer/lang-toggle/templates need no changes:
 *
 *   window.TKNI18n.getLocale()    -> "en"|"tr"|"es"
 *   window.TKNI18n.setLocale(c)   -> Promise<bool>
 *   window.TKNI18n.t(key, fb?)    -> string
 *   window.TKNI18n.onChange(fn)   -> unsub()
 *   window.TKNI18n.apply(rootEl?) -> rewrites every [data-i18n] node
 *   window.TKNI18n.SUPPORTED      -> ["en","tr","es"]
 *
 * Catalogs at /shared/assets/i18n/{en,tr,es}.json use nested namespaces
 * which i18next maps with `keySeparator: "."` (its default). Anything
 * already authored as <span data-i18n="footer.tagline"> keeps working.
 *
 * i18next is loaded from cdnjs with a pinned SRI hash so the strict
 * site-worker CSP (cdnjs.cloudflare.com only) is satisfied. If the load
 * fails we fall back to a tiny inline lookup so the page still renders
 * something instead of going blank.
 */
(function () {
  if (window.TKNI18n) return;

  var STORAGE_KEY = 'tkn-locale';
  var SUPPORTED   = ['en', 'tr', 'es'];
  var DEFAULT     = 'en';
  var BASE_PATH   = '/shared/assets/i18n/';
  var CDN         = 'https://cdnjs.cloudflare.com/ajax/libs/i18next/23.11.5/i18next.min.js';
  var CDN_SRI     = 'sha384-3njZHcYoEjPnHmJyytmlk0xXVVFMVnzTnHSrPjTBHFsd6/IfTSC9TuoYUm3rb7P4';

  var listeners = [];
  var current   = readStoredLocale();
  // Mirror dict for the synchronous fallback path (used before i18next
  // finishes loading and if the CDN is reachable but blocked by SRI).
  var fallbackDicts = {};

  function readStoredLocale() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v && SUPPORTED.indexOf(v) >= 0) return v;
    } catch (e) {}
    var nav = (navigator.language || '').slice(0, 2).toLowerCase();
    if (SUPPORTED.indexOf(nav) >= 0) return nav;
    return DEFAULT;
  }

  function getNested(obj, dotted) {
    if (!obj) return undefined;
    var parts = dotted.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function fetchCatalog(locale) {
    return fetch(BASE_PATH + locale + '.json', { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('catalog ' + locale + ' http ' + r.status);
        return r.json();
      })
      .then(function (j) { fallbackDicts[locale] = j || {}; return j; });
  }

  function loadI18next() {
    if (window.i18next) return Promise.resolve(window.i18next);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = CDN;
      s.integrity = CDN_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = function () { resolve(window.i18next); };
      s.onerror = function () { reject(new Error('i18next CDN load failed')); };
      document.head.appendChild(s);
    });
  }

  function applyLangAttr(locale) {
    try { document.documentElement.setAttribute('lang', locale); } catch (e) {}
  }

  function applyToTree(root) {
    var scope = root || document;
    var els = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-i18n');
      var attr = el.getAttribute('data-i18n-attr');
      var value = api.t(key, null);
      if (value == null) continue;
      if (attr) el.setAttribute(attr, value);
      else el.textContent = value;
    }
  }

  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](current); } catch (e) {}
    }
  }

  var initPromise = null;
  function init() {
    if (initPromise) return initPromise;
    initPromise = Promise.all([fetchCatalog(current), loadI18next().catch(function () { return null; })])
      .then(function (results) {
        var catalog = results[0];
        var i18n = results[1];
        if (i18n) {
          return i18n.init({
            lng: current,
            fallbackLng: DEFAULT,
            resources: (function () {
              var r = {};
              r[current] = { translation: catalog };
              return r;
            })(),
            interpolation: { escapeValue: false },
            keySeparator: '.',
            nsSeparator: false,
          });
        }
      })
      .then(function () {
        applyLangAttr(current);
        applyToTree();
        fire();
      })
      .catch(function (e) {
        if (window.console) console.warn('[i18n] init failed', e);
        // Even on failure, run the fallback rewriter so [data-i18n]
        // nodes get *something* (their key, or their existing default).
        applyLangAttr(current);
        applyToTree();
      });
    return initPromise;
  }

  function loadOtherLocale(locale) {
    return fetchCatalog(locale).then(function (catalog) {
      if (window.i18next && window.i18next.addResourceBundle) {
        window.i18next.addResourceBundle(locale, 'translation', catalog, true, true);
      }
      return catalog;
    });
  }

  var api = {
    SUPPORTED: SUPPORTED.slice(),
    getLocale: function () { return current; },
    setLocale: function (code) {
      if (SUPPORTED.indexOf(code) < 0) return Promise.resolve(false);
      current = code;
      try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
      return loadOtherLocale(code).then(function () {
        if (window.i18next && window.i18next.changeLanguage) {
          return window.i18next.changeLanguage(code);
        }
      }).then(function () {
        applyLangAttr(code);
        applyToTree();
        fire();
        return true;
      });
    },
    t: function (key, fallback) {
      // Prefer i18next when available (it gives us pluralization,
      // interpolation, etc. for free as the catalogs grow).
      if (window.i18next && window.i18next.t) {
        var v = window.i18next.t(key, { defaultValue: '__TKN_MISS__' });
        if (v !== '__TKN_MISS__' && typeof v === 'string') return v;
      }
      // Synchronous fallback while i18next is still loading.
      var dict = fallbackDicts[current] || fallbackDicts[DEFAULT];
      var nested = getNested(dict, key);
      if (typeof nested === 'string') return nested;
      return fallback != null ? fallback : key;
    },
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (x) { return x !== fn; });
      };
    },
    apply: applyToTree,
  };

  window.TKNI18n = api;
  applyLangAttr(current);
  init();
})();
