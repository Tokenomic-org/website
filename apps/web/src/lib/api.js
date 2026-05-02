/**
 * Lightweight API client for the Tokenomic api-worker.
 * - Honors `window.TOKENOMIC_API_BASE` (set by /__config endpoint or env.html).
 * - Forwards SIWE Bearer JWT from localStorage (`tkn-jwt`) and credentialed
 *   cookies for browser sessions.
 * - Caches in-flight GETs to dedupe concurrent identical calls.
 */
const inflight = new Map();

function apiBase() {
  const fallback = 'https://tokenomic-api.guillaumelauzier.workers.dev';
  let base = (typeof window !== 'undefined' && (window.TOKENOMIC_API_BASE || window.__TKN_ENV?.API_BASE)) || fallback;
  return String(base).replace(/\/+$/, '');
}

function bearerToken() {
  try {
    const v = localStorage.getItem('tkn-jwt') || localStorage.getItem('jwt') || '';
    return v && v !== 'null' ? v : '';
  } catch { return ''; }
}

export async function api(path, opts = {}) {
  const url = path.startsWith('http') ? path : apiBase() + path;
  const key = (opts.method || 'GET').toUpperCase() + ' ' + url + (opts.body || '');

  if (!opts.method || opts.method === 'GET') {
    if (inflight.has(key)) return inflight.get(key);
  }

  const headers = new Headers(opts.headers || {});
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (opts.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const tok = bearerToken();
  if (tok && !headers.has('authorization')) headers.set('authorization', 'Bearer ' + tok);

  const promise = (async () => {
    let resp;
    try {
      // Bearer JWT carries auth — no need to forward cookies, which would
      // require the worker to send Access-Control-Allow-Credentials: true.
      resp = await fetch(url, { ...opts, headers, credentials: 'omit' });
    } catch (e) {
      throw new ApiError(0, 'Network error', e?.message || String(e));
    }
    const ct = resp.headers.get('content-type') || '';
    let data = null;
    try { data = ct.includes('application/json') ? await resp.json() : await resp.text(); }
    catch { data = null; }
    if (!resp.ok) {
      const msg = (data && data.error) || resp.statusText || 'Request failed';
      throw new ApiError(resp.status, msg, data);
    }
    return data;
  })();

  if (!opts.method || opts.method === 'GET') {
    inflight.set(key, promise);
    promise.finally(() => setTimeout(() => inflight.delete(key), 30_000));
  }
  return promise;
}

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export function isLoggedIn() {
  return !!bearerToken();
}

export function getApiBase() { return apiBase(); }
