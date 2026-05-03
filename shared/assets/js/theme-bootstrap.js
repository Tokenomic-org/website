/* Flash-free dark/light theme bootstrap for dashboard islands. Reads
 * the user's persisted choice from localStorage('tkn-theme') BEFORE
 * paint so the page never flashes from default-dark to light. Extracted
 * from dashboard/{educator,consultant}/index.html (and any other shell
 * pages) so the strict site-worker CSP can stay at script-src 'self'
 * with no inline-script hashes to maintain per page.
 *
 * Must be loaded as <script src="..."></script> (NOT defer/async) in
 * <head>, before any island stylesheet, to win the paint race.
 */
(function () {
  try {
    var t = localStorage.getItem('tkn-theme');
    if (t !== 'light' && t !== 'dark') t = 'dark';
    var c = document.documentElement.classList;
    if (t === 'light') { c.add('theme-light'); c.remove('dark'); }
    else { c.remove('theme-light'); c.add('dark'); }
  } catch (e) {}
})();
