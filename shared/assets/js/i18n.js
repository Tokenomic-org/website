/* Tokenomic — minimal i18n runtime (Phase 7).
 *
 * Why hand-rolled: shipping i18next + ICU adds ~30 KB and we only need
 * three things: per-key string lookup, a footer language switcher, and
 * a flash-free <html lang> hydration. The catalogs live next to this
 * file and are loaded lazily.
 *
 * Public API (window.TKNI18n):
 *   getLocale()                 -> "en"|"tr"|"es"
 *   setLocale(code)             -> persists to localStorage + reloads tree
 *   t(key, fallback?)           -> string (falls back to key on miss)
 *   onChange(fn)                -> unsub(); fires after locale switch
 *   apply(rootEl?)              -> rewrites all [data-i18n] under rootEl
 *
 * HTML usage:
 *   <span data-i18n="nav.courses">Courses</span>
 *   <a data-i18n-attr="aria-label" data-i18n="footer.lang">Language</a>
 *
 * The catalog file format is:
 *   { "nav": { "courses": "Courses" }, "footer": { "lang": "Language" } }
 */
(function () {
  var STORAGE_KEY = 'tkn-locale';
  var SUPPORTED   = ['en', 'tr', 'es'];
  var DEFAULT     = 'en';
  var BASE_PATH   = '/shared/assets/i18n/';

  var listeners = [];
  var current   = readStoredLocale();
  var dict      = {};
  var loading   = null;

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

  function loadCatalog(locale) {
    if (loading && loading.locale === locale) return loading.promise;
    var p = fetch(BASE_PATH + locale + '.json', { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('catalog ' + locale + ' http ' + r.status);
        return r.json();
      })
      .then(function (json) {
        dict = json || {};
        return json;
      })
      .catch(function (e) {
        // On failure keep the existing dict so the page doesn't go blank.
        if (window.console) console.warn('[i18n] catalog load failed', e);
        return dict;
      });
    loading = { locale: locale, promise: p };
    return p;
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
      var value = getNested(dict, key);
      if (typeof value !== 'string') continue;
      if (attr) el.setAttribute(attr, value);
      else el.textContent = value;
    }
  }

  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](current); } catch (e) {}
    }
  }

  var api = {
    SUPPORTED: SUPPORTED.slice(),
    getLocale: function () { return current; },
    setLocale: function (code) {
      if (SUPPORTED.indexOf(code) < 0) return Promise.resolve(false);
      current = code;
      try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
      applyLangAttr(code);
      return loadCatalog(code).then(function () {
        applyToTree();
        fire();
        return true;
      });
    },
    t: function (key, fallback) {
      var v = getNested(dict, key);
      return typeof v === 'string' ? v : (fallback != null ? fallback : key);
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
  loadCatalog(current).then(function () { applyToTree(); fire(); });
})();
