/**
 * Tokenomic Web3 bundle — wagmi v2 + viem v2 (Phase 0).
 *
 * This module is bundled by esbuild into shared/assets/js/web3-bundle.js and
 * loaded as an ES module on every page. It exposes one global —
 * `window.TokenomicWeb3` — that wraps @wagmi/core v2 with a Base + Base
 * Sepolia config and three connectors (injected, walletConnect,
 * coinbaseWallet). All wallet interactions in the rest of the codebase
 * should funnel through TokenomicWeb3.* so we have a single source of truth
 * for chain id, account, and signature flow.
 *
 * Build-time defines (esbuild --define):
 *   process.env.WC_PROJECT_ID   WalletConnect Cloud project id
 *   process.env.BASE_RPC_URL    optional override (default: mainnet.base.org)
 *   process.env.BASE_SEPOLIA_RPC_URL  optional (default: sepolia.base.org)
 *
 * Legacy compatibility: window.TokenomicViem is still exposed with the
 * read-only USDC/ETH balance helpers older pages (and web3-assets.js) rely
 * on. New code should prefer TokenomicWeb3.readContract / .writeContract.
 */

import {
  createConfig,
  http,
  connect,
  disconnect,
  reconnect,
  getAccount,
  getChainId,
  switchChain,
  watchAccount,
  watchChainId,
  signMessage,
  readContract,
  writeContract,
  getBalance,
  waitForTransactionReceipt,
} from '@wagmi/core';
// Only `injected` is imported eagerly. walletConnect and coinbaseWallet live
// in web3-connectors-src.js and are fetched on demand — see ensureConnector().
import { injected } from '@wagmi/connectors';
import { base, baseSepolia } from 'viem/chains';
import {
  createPublicClient,
  formatUnits,
  parseUnits,
  getAddress,
  isAddress,
  parseAbi,
} from 'viem';

// --- Build-time defines (esbuild --define replaces these literals) -------
// Default to empty string so the bundle still loads when the env var is not
// wired during a local build; WalletConnect is then quietly disabled.
const WC_PROJECT_ID =
  (typeof process !== 'undefined' && process.env && process.env.WC_PROJECT_ID) || '';
const BASE_RPC_URL =
  (typeof process !== 'undefined' && process.env && process.env.BASE_RPC_URL) ||
  'https://mainnet.base.org';
const BASE_SEPOLIA_RPC_URL =
  (typeof process !== 'undefined' && process.env && process.env.BASE_SEPOLIA_RPC_URL) ||
  'https://sepolia.base.org';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// --- wagmi config --------------------------------------------------------
// Only the injected connector is registered up front. It is what reconnect()
// needs to silently restore a MetaMask/Rabby/Brave session, and it is small.
// WalletConnect and Coinbase Wallet are registered lazily by
// ensureConnector() below, because together they are ~2.1MB of the old
// eager payload and are only reachable behind a deliberate click.
const connectors = [injected({ shimDisconnect: true })];

const config = createConfig({
  chains: [base, baseSepolia],
  multiInjectedProviderDiscovery: true,
  ssr: false,
  transports: {
    [base.id]: http(BASE_RPC_URL),
    [baseSepolia.id]: http(BASE_SEPOLIA_RPC_URL),
  },
  connectors,
});

// --- read-only viem client (kept for legacy TokenomicViem surface) -------
const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

async function readUSDCBalance(address) {
  if (!address || !isAddress(address)) return '0.00';
  const raw = await publicClient.readContract({
    address: USDC_BASE,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
  return formatUnits(raw, 6);
}
async function readETHBalance(address) {
  if (!address || !isAddress(address)) return '0.0000';
  const raw = await publicClient.getBalance({ address: getAddress(address) });
  return parseFloat(formatUnits(raw, 18)).toFixed(4);
}
async function readERC20(token, address) {
  if (!address || !isAddress(address)) return '0';
  const [bal, dec] = await Promise.all([
    publicClient.readContract({
      address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [getAddress(address)],
    }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }),
  ]);
  return formatUnits(bal, dec);
}

// --- lazy connector registration ----------------------------------------
//
// The heavy connectors are fetched on first use and registered against the
// live config, so `config.connectors` ends up in exactly the state the
// pre-split bundle had — callers that look a connector up by id keep working
// unchanged.
//
// The import specifier is held in a variable on purpose: esbuild only inlines
// a dynamic import when the specifier is a static string it can resolve, so
// this keeps the chunk a genuinely separate network request. The path is
// absolute so it resolves the same from any page depth.
const CONNECTORS_CHUNK_URL = '/shared/assets/js/web3-connectors.js';

// id, as reported by the connector instance, for each kind we can lazy-load.
const LAZY_CONNECTOR_IDS = {
  'walletconnect': ['walletConnect'],
  'coinbase-smart': ['coinbaseWalletSDK', 'coinbaseWallet'],
};

// In-flight promises, so two rapid clicks don't fetch the chunk twice.
const pendingConnectorLoads = {};

function findRegisteredConnector(kind) {
  const ids = LAZY_CONNECTOR_IDS[kind] || [];
  const live = (config && config.connectors) || [];
  return live.find((c) => ids.includes(c.id)) || null;
}

/**
 * Make sure the connector for `kind` ('walletconnect' | 'coinbase-smart') is
 * registered on the config, fetching the connectors chunk if needed.
 *
 * Resolves with the connector instance, or null when it cannot be provided
 * (unknown kind, or WalletConnect without a build-time project id). Never
 * throws for the "not configured" case — callers surface their own message.
 */
async function ensureConnector(kind) {
  const already = findRegisteredConnector(kind);
  if (already) return already;

  if (!LAZY_CONNECTOR_IDS[kind]) return null;

  if (!pendingConnectorLoads[kind]) {
    pendingConnectorLoads[kind] = (async () => {
      const mod = await import(/* webpackIgnore: true */ CONNECTORS_CHUNK_URL);
      const factory = mod.connectorFor(kind);
      if (!factory) return null;
      // setup() turns the factory into a live Connector bound to this config;
      // setState() appends it to the reactive connector list.
      const instance = config._internal.connectors.setup(factory);
      config._internal.connectors.setState((prev) => [...prev, instance]);
      return instance;
    })().catch((err) => {
      // Let a later attempt retry rather than caching the failure forever.
      delete pendingConnectorLoads[kind];
      throw err;
    });
  }

  await pendingConnectorLoads[kind];
  return findRegisteredConnector(kind);
}

// --- public surface ------------------------------------------------------
const TokenomicWeb3 = {
  // config + identity
  config,
  chains: { base, baseSepolia },
  defaultChain: base,
  USDC_BASE,
  USDC_BASE_SEPOLIA,
  WC_PROJECT_ID,
  // connectors. Only `injected` is present eagerly; the other two arrive via
  // ensureConnector(), which registers them on `config` on first use.
  connectors: { injected },
  ensureConnector,
  // wagmi/core proxies
  connect: (params = {}) => connect(config, params),
  disconnect: () => disconnect(config),
  reconnect: () => reconnect(config),
  getAccount: () => getAccount(config),
  getChainId: () => getChainId(config),
  switchChain: (chainId) => switchChain(config, { chainId }),
  signMessage: (params) => signMessage(config, params),
  readContract: (params) => readContract(config, params),
  writeContract: (params) => writeContract(config, params),
  waitForTransactionReceipt: (params) => waitForTransactionReceipt(config, params),
  getBalance: (params) => getBalance(config, params),
  watchAccount: (onChange) => watchAccount(config, { onChange }),
  watchChainId: (onChange) => watchChainId(config, { onChange }),
  // viem helpers
  publicClient,
  isAddress,
  getAddress,
  formatUnits,
  parseUnits,
  ERC20_ABI,
  // helpers used by web3-wallet.js
  switchToBase: async (preferTestnet = false) => {
    try {
      await switchChain(config, {
        chainId: preferTestnet ? baseSepolia.id : base.id,
      });
      return true;
    } catch (err) {
      // user rejected or chain add failed; let caller surface the error
      throw err;
    }
  },
};

const TokenomicViem = {
  client: publicClient,
  chain: base,
  USDC_BASE,
  readUSDCBalance,
  readETHBalance,
  readERC20,
  isAddress,
  getAddress,
  formatUnits,
};

if (typeof window !== 'undefined') {
  window.TokenomicWeb3 = TokenomicWeb3;
  window.TokenomicViem = TokenomicViem;
  // Restore previous session silently. Failures are expected the first time
  // a visitor lands without a connected wallet — never throw to the page.
  try {
    reconnect(config).catch(() => {});
  } catch (_) { /* noop */ }
  window.dispatchEvent(new CustomEvent('tkn:web3-ready', { detail: TokenomicWeb3 }));
  window.dispatchEvent(new CustomEvent('tkn:viem-ready', { detail: TokenomicViem }));
}

export default TokenomicWeb3;
export {
  config,
  base,
  baseSepolia,
  publicClient,
  readUSDCBalance,
  readETHBalance,
  readERC20,
  USDC_BASE,
  USDC_BASE_SEPOLIA,
};
