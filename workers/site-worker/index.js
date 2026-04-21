/**
 * tokenomic site worker
 *
 * Serves the static Jekyll build (`_site/`) via the ASSETS binding while
 * also exposing a small runtime config endpoint backed by the Worker's
 * env vars + secrets — the reason this Worker has a script at all
 * (Cloudflare disallows variables on static-assets-only Workers).
 *
 *   GET /__health    -> { ok, ts }
 *   GET /__config    -> public env (safe subset, no secrets)
 *   *                -> static asset (assets binding)
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/__health') {
      return Response.json({ ok: true, ts: Date.now(), worker: 'tokenomic' });
    }

    if (url.pathname === '/__config') {
      // Whitelist only safe public values. Never echo secrets.
      const cfg = {
        BASE_CHAIN_ID:             env.BASE_CHAIN_ID || '8453',
        BASE_RPC_URL:              env.BASE_RPC_URL || 'https://mainnet.base.org',
        USDC_CONTRACT:             env.USDC_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        MARKET_CONTRACT:           env.MARKET_CONTRACT || '',
        CERTIFICATE_CONTRACT:      env.CERTIFICATE_CONTRACT || '',
        ETH_GATEWAY_URL:           env.ETH_GATEWAY_URL || '',
        BASESCAN_BASE:             env.BASESCAN_BASE || 'https://basescan.org',
        API_BASE:                  env.API_BASE || '',
        WEB3_BASE:                 env.WEB3_BASE || '',
        STREAM_CUSTOMER_SUBDOMAIN: env.STREAM_CUSTOMER_SUBDOMAIN || ''
      };
      return Response.json(cfg, {
        headers: { 'cache-control': 'public, max-age=60' }
      });
    }

    // Fall through to static assets.
    return env.ASSETS.fetch(request);
  }
};
