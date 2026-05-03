/* Tokenomic — footer language toggle (Phase 7).
 * Renders into any element with id="tkn-lang-toggle". Persists choice
 * via TKNI18n.setLocale(), which also updates <html lang>.
 */
(function () {
  function build() {
    var host = document.getElementById('tkn-lang-toggle');
    if (!host || !window.TKNI18n) return;

    // Idempotent: clear so a re-render after locale change doesn't duplicate.
    host.innerHTML = '';
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Language selector');

    var labels = { en: 'English', tr: 'Türkçe', es: 'Español' };
    var current = window.TKNI18n.getLocale();
    var sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Language');
    sel.style.cssText =
      'background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.18);' +
      'border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;';
    window.TKNI18n.SUPPORTED.forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = labels[code] || code.toUpperCase();
      opt.style.color = '#000';
      if (code === current) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      window.TKNI18n.setLocale(sel.value);
    });
    host.appendChild(sel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
  // Re-bind after locale switches (some pages re-render the footer).
  var iv = setInterval(function () {
    if (window.TKNI18n) {
      clearInterval(iv);
      window.TKNI18n.onChange(function () { build(); });
    }
  }, 200);
})();
