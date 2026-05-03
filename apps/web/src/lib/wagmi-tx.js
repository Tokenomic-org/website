/**
 * Thin async helper that proxies wallet calls through the existing
 * `window.TokenomicWeb3` facade (see shared/assets/js/web3-bundle-src.js),
 * which wraps `@wagmi/core` v2 with a Base + Base-Sepolia configuration
 * shared by the rest of the site.
 *
 * Always preferred over direct `window.ethereum` access so:
 *   - WalletConnect / Coinbase Smart Wallet flows are honored
 *   - chain switching is consistent with the connect modal
 *   - one observable account state drives both the legacy header pill and
 *     the React islands
 *
 * Falls back to `window.ethereum` only when the facade has not finished
 * bootstrapping (best-effort, mostly during local dev page hot-reloads).
 */

const RoleRegistryAbi = [
  {
    type: 'function',
    name: 'grantRole',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeRole',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [],
  },
];

function getFacade() {
  if (typeof window === 'undefined') return null;
  return window.TokenomicWeb3 || null;
}

async function ensureConnected() {
  const W = getFacade();
  if (W && typeof W.getAccount === 'function') {
    const acct = W.getAccount();
    if (acct && acct.address) return acct.address;
  }
  if (typeof window !== 'undefined' && window.TokenomicWallet?.connect) {
    await window.TokenomicWallet.connect();
    const W2 = getFacade();
    const acct2 = W2 && W2.getAccount && W2.getAccount();
    if (acct2 && acct2.address) return acct2.address;
  }
  // Last-ditch fallback to direct injected provider.
  if (typeof window !== 'undefined' && window.ethereum) {
    const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (accs && accs[0]) return accs[0];
  }
  throw new Error('No wallet connected');
}

/**
 * Send a RoleRegistry grantRole / revokeRole transaction through wagmi.
 * Returns the tx hash. Throws on user rejection or RPC error.
 */
export async function sendRoleTx({ registry, action, roleHash, target }) {
  if (!registry) throw new Error('RoleRegistry address is not configured');
  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) throw new Error('Invalid target address');
  const fnName = action === 'revoke' ? 'revokeRole' : 'grantRole';
  await ensureConnected();
  const W = getFacade();
  if (W && typeof W.writeContract === 'function') {
    return W.writeContract({
      address: registry,
      abi: RoleRegistryAbi,
      functionName: fnName,
      args: [roleHash, target],
    });
  }
  // Fallback: encode calldata by hand and use eth_sendTransaction. This
  // path is only hit if the wagmi bundle failed to load.
  const SELECTORS = { grantRole: '0x2f2ff15d', revokeRole: '0xd547741f' };
  const data = SELECTORS[fnName]
    + roleHash.replace(/^0x/, '').padStart(64, '0')
    + target.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const from = await ensureConnected();
  return window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: registry, data, value: '0x0' }],
  });
}
