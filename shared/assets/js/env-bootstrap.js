/* Tokenomic — env bootstrap (Phase 7 / strict CSP)
 *
 * Reads the Jekyll-emitted JSON data island
 *   <script type="application/json" id="tkn-env">{...}</script>
 * and exposes it as `window.__TKN_ENV` (+ `window.TOKENOMIC_API_BASE`
 * back-compat alias). Replaces the old inline `<script>` in
 * _includes/env.html so script-src can stay strict.
 */
(function () {
  var node = document.getElementById('tkn-env');
  var env = {};
  if (node) {
    try { env = JSON.parse(node.textContent || '{}'); } catch (e) { env = {}; }
  }
  // Coerce chain id to a number — Jekyll renders it as a string in JSON.
  if (env.BASE_CHAIN_ID != null) env.BASE_CHAIN_ID = Number(env.BASE_CHAIN_ID);
  window.__TKN_ENV = env;
  window.TOKENOMIC_API_BASE = env.API_BASE || window.TOKENOMIC_API_BASE || '';
})();
