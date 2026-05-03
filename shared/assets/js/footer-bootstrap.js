/* Footer copyright-year setter. Extracted from _includes/footer.html so
 * the strict site-worker CSP can stay at script-src 'self' + the single
 * hashed island bootstrap (no extra inline-script hashes to maintain).
 */
(function () {
  var el = document.getElementById('copyright-year');
  if (el) el.textContent = new Date().getFullYear();
})();
