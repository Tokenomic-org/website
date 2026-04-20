/**
 * web3-worker
 * Hono app proxying read-only on-chain calls so the frontend never has to know
 * which RPC endpoint to hit.
 *
 *   GET  /api/web3/health
 *   GET  /api/web3/chain                       block number + chain id
 *   GET  /api/web3/usdc/:address               USDC balance for address (Base)
 *   GET  /api/web3/eth/:address                ETH balance (Base)
 *   GET  /api/web3/erc721/:contract/:address   ERC-721 balanceOf (e.g. cert NFT)
 *   GET  /api/web3/erc1155/:contract/:address/:id  ERC-1155 balanceOf (course access)
 *   POST /api/web3/rpc                         pass-through JSON-RPC (rate limited, allow-list of methods)
 *
 * Env vars:
 *   - BASE_RPC_URL              default https://mainnet.base.org
 *   - CLOUDFLARE_ETH_GATEWAY    optional alt RPC (Ethereum mainnet)
 *   - ALLOWED_ORIGINS           comma-separated CORS list
 *
 * Uses ethers v6 (`JsonRpcProvider`).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { JsonRpcProvider, Contract, formatUnits, isAddress, getAddress } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
const ERC721_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const ERC1155_ABI = ['function balanceOf(address account, uint256 id) view returns (uint256)'];

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const RPC_ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getBalance',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_estimateGas',
  'eth_gasPrice'
]);

const app = new Hono();
app.use('*', logger());

app.use('*', async (c, next) => {
  const allowList = (c.env.ALLOWED_ORIGINS || 'https://tokenomic.org,https://*.tokenomic.org,https://*.cf-ipfs.com,https://*.pages.dev,http://localhost:5000')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const handler = cors({
    origin: (origin) => {
      if (!origin) return '*';
      for (const p of allowList) {
        if (p === origin) return origin;
        if (p.startsWith('https://*.')) {
          const suffix = p.slice('https://*.'.length);
          if (origin.endsWith('.' + suffix)) return origin;
        }
      }
      return null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86400
  });
  return handler(c, next);
});

const memoryRL = new Map();
async function rateLimit(c, key, limit = 30, windowSec = 60) {
  const now = Date.now();
  const bucketKey = `rl:${key}`;
  let bucket = memoryRL.get(bucketKey);
  if (!bucket || now > bucket.reset) bucket = { count: 0, reset: now + windowSec * 1000 };
  bucket.count += 1;
  memoryRL.set(bucketKey, bucket);
  return { ok: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), reset: bucket.reset };
}

function ip(c) { return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'anon'; }
function provider(c) { return new JsonRpcProvider(c.env.BASE_RPC_URL || 'https://mainnet.base.org'); }
function ethProvider(c) {
  const url = c.env.CLOUDFLARE_ETH_GATEWAY || c.env.BASE_RPC_URL || 'https://mainnet.base.org';
  return new JsonRpcProvider(url);
}

const memCache = new Map();
async function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = memCache.get(key);
  if (hit && hit.expires > now) return hit.value;
  const value = await fn();
  memCache.set(key, { value, expires: now + ttlMs });
  return value;
}

app.get('/api/web3/health', (c) => c.json({
  ok: true, worker: 'web3-worker',
  rpc: c.env.BASE_RPC_URL || 'https://mainnet.base.org',
  ethGateway: c.env.CLOUDFLARE_ETH_GATEWAY || null
}));

app.get('/api/web3/chain', async (c) => {
  try {
    const p = provider(c);
    const [net, block] = await Promise.all([p.getNetwork(), p.getBlockNumber()]);
    return c.json({ ok: true, chainId: Number(net.chainId), blockNumber: block });
  } catch (e) {
    console.error('chain failed:', e);
    return c.json({ ok: false, error: e.message }, 502);
  }
});

app.get('/api/web3/usdc/:address', async (c) => {
  const addr = c.req.param('address');
  if (!isAddress(addr)) return c.json({ error: 'Invalid address' }, 400);
  try {
    const cs = getAddress(addr);
    const value = await cached(`usdc:${cs}`, 15000, async () => {
      const p = provider(c);
      const usdc = new Contract(USDC_BASE, ERC20_ABI, p);
      const raw = await usdc.balanceOf(cs);
      return formatUnits(raw, 6);
    });
    return c.json({ ok: true, address: cs, token: 'USDC', balance: value });
  } catch (e) {
    console.error('usdc balance failed:', e);
    return c.json({ ok: false, error: e.message }, 502);
  }
});

app.get('/api/web3/eth/:address', async (c) => {
  const addr = c.req.param('address');
  if (!isAddress(addr)) return c.json({ error: 'Invalid address' }, 400);
  try {
    const cs = getAddress(addr);
    const value = await cached(`eth:${cs}`, 15000, async () => {
      const p = provider(c);
      const raw = await p.getBalance(cs);
      return formatUnits(raw, 18);
    });
    return c.json({ ok: true, address: cs, token: 'ETH', balance: value });
  } catch (e) {
    return c.json({ ok: false, error: e.message }, 502);
  }
});

app.get('/api/web3/erc721/:contract/:address', async (c) => {
  const ct = c.req.param('contract');
  const addr = c.req.param('address');
  if (!isAddress(ct) || !isAddress(addr)) return c.json({ error: 'Invalid contract or address' }, 400);
  try {
    const p = provider(c);
    const nft = new Contract(getAddress(ct), ERC721_ABI, p);
    const raw = await nft.balanceOf(getAddress(addr));
    const balance = Number(raw);
    return c.json({ ok: true, contract: ct, address: addr, balance, owns: balance > 0 });
  } catch (e) {
    return c.json({ ok: false, error: e.message }, 502);
  }
});

app.get('/api/web3/erc1155/:contract/:address/:id', async (c) => {
  const ct = c.req.param('contract');
  const addr = c.req.param('address');
  const id = c.req.param('id');
  if (!isAddress(ct) || !isAddress(addr)) return c.json({ error: 'Invalid contract or address' }, 400);
  if (!/^\d+$/.test(id)) return c.json({ error: 'Invalid token id' }, 400);
  try {
    const p = provider(c);
    const nft = new Contract(getAddress(ct), ERC1155_ABI, p);
    const raw = await nft.balanceOf(getAddress(addr), BigInt(id));
    const balance = Number(raw);
    return c.json({ ok: true, contract: ct, address: addr, id, balance, owns: balance > 0 });
  } catch (e) {
    return c.json({ ok: false, error: e.message }, 502);
  }
});

app.post('/api/web3/rpc', async (c) => {
  const rl = await rateLimit(c, `${ip(c)}:rpc`, 10, 60);
  c.header('X-RateLimit-Limit', String(rl.limit));
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return c.json({ error: 'Rate limit exceeded' }, 429);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const method = body && body.method;
  if (!method || !RPC_ALLOWED_METHODS.has(method)) {
    return c.json({ error: 'Method not allowed', method }, 403);
  }
  const params = Array.isArray(body.params) ? body.params : [];
  try {
    const url = c.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id || 1, method, params })
    });
    const json = await upstream.json();
    return c.json(json, upstream.status);
  } catch (e) {
    return c.json({ error: 'Upstream RPC failed', message: e.message }, 502);
  }
});

app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal error', message: err.message }, 500);
});

export default app;
