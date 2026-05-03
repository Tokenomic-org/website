/**
 * RoleRegistry on-chain reader (Phase 3a).
 *
 * Reads the EDUCATOR_ROLE / CONSULTANT_ROLE / ADMIN_ROLE / PLATFORM_ROLE /
 * TREASURY_ROLE bits from the deployed `RoleRegistry` (OpenZeppelin
 * AccessControl). Results are cached in `RATE_LIMIT_KV` (re-using the
 * existing namespace) under `roles:<chainId>:<wallet>` for 60 seconds so
 * every admin/console request does NOT round-trip the chain.
 *
 *   const r = await readRoles(env, '0xabc…');
 *   // -> { roles: ['learner','educator'], chainRoles: ['EDUCATOR_ROLE'],
 *   //      cached: false, ts: 1714780000 }
 *
 * Env contract:
 *   ROLE_REGISTRY                deployed address (current chain)
 *   ROLE_REGISTRY_CHAIN_ID       8453 (default) | 84532
 *   BASE_RPC_URL / BASE_SEPOLIA_RPC_URL
 *
 * The reader is intentionally fail-open (returns ['learner']) when the
 * contract isn't configured yet so local dev / preview environments don't
 * break before the registry is deployed. Admin gating layers MUST also
 * check the env allowlist (`ADMIN_WALLETS`).
 */

import { createPublicClient, http, keccak256, toBytes, getAddress } from 'viem';

const ROLE_NAMES = {
  EDUCATOR_ROLE:   'educator',
  CONSULTANT_ROLE: 'consultant',
  ADMIN_ROLE:      'admin',
  PLATFORM_ROLE:   'admin',  // platform ops act as admins on the dashboard
  TREASURY_ROLE:   'treasury',
};

// Pre-compute keccak256 hashes once per worker isolate.
const ROLE_HASHES = Object.fromEntries(
  Object.keys(ROLE_NAMES).map((name) => [name, keccak256(toBytes(name))])
);
// DEFAULT_ADMIN_ROLE in OZ AccessControl is the zero hash.
ROLE_HASHES.DEFAULT_ADMIN_ROLE = '0x' + '00'.repeat(32);

export const ROLE_HASH = ROLE_HASHES;

const HAS_ROLE_ABI = [
  {
    type: 'function',
    name: 'hasRole',
    stateMutability: 'view',
    inputs:  [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const CACHE_TTL_SEC = 60;
const memoryCache = new Map(); // fallback when KV is missing

function lc(s) { return (s || '').toString().toLowerCase(); }
function isHexAddress(s) { return /^0x[0-9a-fA-F]{40}$/.test(s || ''); }

function chainConfig(env) {
  const id = Number(env.ROLE_REGISTRY_CHAIN_ID || env.SUBSCRIPTION_CHAIN_ID || 8453);
  const isSepolia = id === 84532;
  return {
    chainId: id,
    rpcUrl: isSepolia ? (env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
                      : (env.BASE_RPC_URL || 'https://mainnet.base.org'),
    address: env.ROLE_REGISTRY || '',
  };
}

async function cacheGet(env, key) {
  if (env.RATE_LIMIT_KV) {
    try {
      const raw = await env.RATE_LIMIT_KV.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { /* fall through to memory */ }
  }
  const m = memoryCache.get(key);
  if (m && m.exp > Date.now()) return m.value;
  if (m) memoryCache.delete(key);
  return null;
}

async function cachePut(env, key, value) {
  const payload = JSON.stringify(value);
  if (env.RATE_LIMIT_KV) {
    try {
      await env.RATE_LIMIT_KV.put(key, payload, { expirationTtl: CACHE_TTL_SEC });
      return;
    } catch { /* fall through */ }
  }
  memoryCache.set(key, { value, exp: Date.now() + CACHE_TTL_SEC * 1000 });
}

/**
 * Read the on-chain role bits for `wallet`. Returns:
 *   { roles: ['learner', 'educator', …],   // normalized app-level role names
 *     chainRoles: ['EDUCATOR_ROLE', …],    // raw OZ constants (bytes32 names)
 *     cached: boolean,
 *     ts: <unix sec>,
 *     source: 'chain' | 'cache' | 'unconfigured' }
 */
export async function readRoles(env, wallet) {
  if (!isHexAddress(wallet)) {
    return { roles: [], chainRoles: [], cached: false, source: 'invalid', ts: 0 };
  }
  const w = lc(wallet);
  const cfg = chainConfig(env);
  if (!cfg.address) {
    // Fail-open: return base learner role; admin gates should still check env.
    return { roles: ['learner'], chainRoles: [], cached: false, source: 'unconfigured', ts: 0 };
  }

  const cacheKey = `roles:${cfg.chainId}:${w}`;
  const hit = await cacheGet(env, cacheKey);
  if (hit) return { ...hit, cached: true, source: 'cache' };

  const client = createPublicClient({ transport: http(cfg.rpcUrl) });
  const account = getAddress(w);

  // Multicall not used here to keep the dependency tree tiny; 5 sequential
  // RPC reads at TTL=60s amortize to ~5 reads per minute per active wallet.
  const checks = ['EDUCATOR_ROLE', 'CONSULTANT_ROLE', 'PLATFORM_ROLE', 'TREASURY_ROLE', 'DEFAULT_ADMIN_ROLE'];
  const results = await Promise.all(
    checks.map(async (name) => {
      try {
        const has = await client.readContract({
          address: cfg.address,
          abi: HAS_ROLE_ABI,
          functionName: 'hasRole',
          args: [ROLE_HASHES[name], account],
        });
        return [name, !!has];
      } catch (_e) {
        return [name, false];
      }
    })
  );

  const chainRoles = results.filter(([, has]) => has).map(([n]) => n);
  const appRoles = new Set(['learner']);
  for (const [name, has] of results) {
    if (!has) continue;
    const mapped = name === 'DEFAULT_ADMIN_ROLE' ? 'admin' : ROLE_NAMES[name];
    if (mapped) appRoles.add(mapped);
  }

  const value = {
    roles: Array.from(appRoles),
    chainRoles,
    ts: Math.floor(Date.now() / 1000),
  };
  await cachePut(env, cacheKey, value);
  return { ...value, cached: false, source: 'chain' };
}

/** Best-effort cache invalidation after a role grant/revoke tx is confirmed. */
export async function invalidateRolesCache(env, wallet) {
  if (!isHexAddress(wallet)) return;
  const cfg = chainConfig(env);
  const key = `roles:${cfg.chainId}:${lc(wallet)}`;
  if (env.RATE_LIMIT_KV) {
    try { await env.RATE_LIMIT_KV.delete(key); } catch {}
  }
  memoryCache.delete(key);
}

export function getRoleRegistryConfig(env) {
  return chainConfig(env);
}
