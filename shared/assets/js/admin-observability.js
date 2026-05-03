/* Admin observability page logic. Extracted from
 * dashboard/admin/observability.html so the strict site-worker CSP
 * (script-src 'self' + the single hashed island bootstrap) can stay
 * intact without per-page hashes. Talks to the API worker's
 * /admin/observability/{summary,routes,errors} endpoints, which are
 * gated behind the SIWE cookie + admin role check.
 */
(function () {
  var API = (window.__TKN_ENV && window.__TKN_ENV.API_BASE) || '';

  function url(path, q) {
    var u = API + path;
    if (q) u += '?' + Object.keys(q).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]);
    }).join('&');
    return u;
  }
  function fmt(n) {
    if (n == null || isNaN(n)) return '\u2014';
    n = Number(n);
    if (n > 1000) return (n / 1000).toFixed(1) + 'k';
    return n.toFixed(n < 10 ? 1 : 0);
  }
  function ms(n) { return n == null ? '\u2014' : Math.round(Number(n)) + ' ms'; }

  function notConfigured(missing) {
    var box = document.getElementById('not-configured');
    box.style.display = 'block';
    box.textContent =
      'Workers Analytics Engine is not configured. Missing secrets: ' +
      (missing || []).join(', ') +
      '. See workers/api-worker/SECRETS.md for setup instructions.';
  }

  function authRequired() {
    document.getElementById('auth-required').style.display = 'block';
  }

  function readRow(data, key) {
    var rows = (data && data.data) || [];
    return rows[0] && rows[0][key];
  }

  function loadAll() {
    var w = document.getElementById('window').value;
    var headers = { 'Accept': 'application/json' };
    var opts = { credentials: 'include', headers: headers };

    fetch(url('/admin/observability/summary', { window: w }), opts)
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { authRequired(); throw new Error('auth'); }
        return r.json();
      })
      .then(function (j) {
        if (!j.ok && j.error === 'analytics-not-configured') {
          notConfigured(j.missing); return;
        }
        document.getElementById('m-requests').textContent = fmt(readRow(j, 'requests'));
        document.getElementById('m-latency').textContent  = ms(readRow(j, 'avg_latency_ms'));
        document.getElementById('m-p95').textContent      = ms(readRow(j, 'p95_latency_ms'));
        document.getElementById('m-5xx').textContent      = fmt(readRow(j, 'errors_5xx'));
        document.getElementById('m-4xx').textContent      = fmt(readRow(j, 'errors_4xx'));
      })
      .catch(function () {});

    fetch(url('/admin/observability/routes', { window: w }), opts)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var tbody = document.querySelector('#routes-table tbody');
        tbody.innerHTML = '';
        var rows = (j && j.data) || [];
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="muted">No traffic in window.</td></tr>';
          return;
        }
        rows.forEach(function (r) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + (r.route || '\u2014') + '</td>' +
            '<td>' + fmt(r.requests) + '</td>' +
            '<td>' + ms(r.avg_latency_ms) + '</td>' +
            '<td>' + ms(r.p95_latency_ms) + '</td>' +
            '<td>' + fmt(r.errors_5xx) + '</td>';
          tbody.appendChild(tr);
        });
      })
      .catch(function () {});

    fetch(url('/admin/observability/errors', { window: w }), opts)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var tbody = document.querySelector('#errors-table tbody');
        tbody.innerHTML = '';
        var rows = (j && j.data) || [];
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="6" class="muted">No errors in window. Nice.</td></tr>';
          return;
        }
        rows.forEach(function (r) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td class="muted">' + new Date(r.timestamp).toLocaleTimeString() + '</td>' +
            '<td>' + (r.route || '\u2014') + '</td>' +
            '<td>' + (r.method || '') + '</td>' +
            '<td>' + Math.round(r.status || 0) + '</td>' +
            '<td>' + (r.country || 'XX') + '</td>' +
            '<td>' + ms(r.latency_ms) + '</td>';
          tbody.appendChild(tr);
        });
      })
      .catch(function () {});
  }

  document.getElementById('refresh').addEventListener('click', loadAll);
  document.getElementById('window').addEventListener('change', loadAll);
  loadAll();
})();
