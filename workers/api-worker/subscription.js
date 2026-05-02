/**
 * SubscriptionManager.isActive(address) → bool — viem-backed read.
 *
 * Cached per-instance for 60s to avoid hammering Base RPC on hot articles.
 * Conservative: any error (no contract address, RPC failure, ABI mismatch)
 * returns `false` so the paywall stays closed.
 */
import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';

const ABI = [
  {
    type: 'function',
    name: 'isActive',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const cache = new Map(); // wallet → { value, ts }
const TTL_MS = 60_000;

function chainFor(env) {
  const chainId = Number(env.SUBSCRIPTION_CHAIN_ID || env.BASE_CHAIN_ID || 8453);
  return chainId === 84532 ? baseSepolia : base;
}

function rpcUrlFor(env) {
  const chain = chainFor(env);
  if (chain.id === 84532) return env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
  return env.BASE_RPC_URL || 'https://mainnet.base.org';
}

/** Returns true iff the wallet has an active SubscriptionManager subscription. */
export async function isSubscriptionActive(env, wallet) {
  if (!wallet || typeof wallet !== 'string') return false;
  const addr = (env.SUBSCRIPTION_MANAGER || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return false;

  const key = wallet.toLowerCase() + ':' + addr.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;

  try {
    const client = createPublicClient({
      chain: chainFor(env),
      transport: http(rpcUrlFor(env)),
    });
    const value = await client.readContract({
      address: addr,
      abi: ABI,
      functionName: 'isActive',
      args: [wallet],
    });
    const out = !!value;
    cache.set(key, { value: out, ts: Date.now() });
    return out;
  } catch (err) {
    console.warn('[subscription] isActive failed:', err?.shortMessage || err?.message || err);
    return false;
  }
}
