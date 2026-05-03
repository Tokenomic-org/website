/* Island theme bootstrap — extracted from _includes/island-bootstrap.html.
 *
 * Two responsibilities, kept in one file so a single <script src=…> in
 * the include covers both and we can keep STRICT_SCRIPT_SRC at exactly
 * `'self'` (no hashes, no inline anywhere).
 *
 *   1. Pre-paint dark-mode class application. Loaded as a synchronous
 *      external script in <head> so the class lands before Tailwind's
 *      first paint and the page never flashes from default-dark to
 *      light. Trades one HTTP roundtrip for zero FOUC.
 *
 *   2. Theme-toggle floating button click handler. Lives outside the
 *      React tree so even if an island fails to hydrate the user can
 *      still flip themes.
 */
(function () {
  // (1) pre-paint dark/light selection
  try {
    var t = localStorage.getItem('tkn-theme');
    if (t !== 'light' && t !== 'dark') t = 'dark';
    var c = document.documentElement.classList;
    if (t === 'light') { c.add('theme-light'); c.remove('dark'); }
    else { c.remove('theme-light'); c.add('dark'); }
  } catch (e) {}

  // (2) wire the floating toggle button. defer until DOM ready since
  // the <button id="tk-theme-fab"> sits below this script in the HTML.
  function wireFab() {
    var btn = document.getElementById('tk-theme-fab');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var c = document.documentElement.classList;
      var nowLight = !c.contains('theme-light');
      if (nowLight) { c.add('theme-light'); c.remove('dark'); }
      else { c.remove('theme-light'); c.add('dark'); }
      try { localStorage.setItem('tkn-theme', nowLight ? 'light' : 'dark'); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('tkn-theme', { detail: nowLight ? 'light' : 'dark' })); } catch (e) {}
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireFab);
  } else {
    wireFab();
  }
})();
