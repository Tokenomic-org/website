/*
 * island-theme-prepaint.js
 *
 * Pre-paint dark-mode bootstrap. Reads the persisted theme preference from
 * localStorage and toggles the appropriate <html> class BEFORE the main
 * stylesheet starts painting, so the page does not flash light-on-dark
 * during navigation.
 *
 * MUST be loaded as a synchronous external <script> in <head>, BEFORE the
 * stylesheet link. Because it is not deferred, it runs while the parser is
 * blocked, which is the only way to win the FOUC race without an inline
 * script.
 *
 * Replaces the inline IIFE that previously lived in
 * _includes/island-bootstrap.html (and required a 'sha256-…' allowance in
 * the site-worker CSP). With this file external, that allowance has been
 * removed — see infra/cloudflare/csp-rollout.md.
 */
(function () {
  try {
    var t = localStorage.getItem('tkn-theme');
    if (t !== 'light' && t !== 'dark') t = 'dark';
    var cl = document.documentElement.classList;
    if (t === 'light') {
      cl.add('theme-light');
      cl.remove('dark');
    } else {
      cl.remove('theme-light');
      cl.add('dark');
    }
  } catch (e) {
    /* localStorage disabled (private mode, embedded webview) — fall through
       to the default dark theme set by the stylesheet. */
  }
})();
