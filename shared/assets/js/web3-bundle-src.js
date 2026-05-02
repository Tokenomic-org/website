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
import {
  injected,
  walletConnect,
  coinbaseWallet,
} from '@wagmi/connectors';
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
const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({
    appName: 'Tokenomic',
    appLogoUrl: 'https://tokenomic.org/assets/images/logo.png',
    preference: 'all', // EOA wallet OR Smart Wallet (passkey)
  }),
];
if (WC_PROJECT_ID) {
  connectors.push(
    walletConnect({
      projectId: WC_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: 'Tokenomic',
        description: 'Institutional DeFi education on Base',
        url: 'https://tokenomic.org',
        icons: ['https://tokenomic.org/assets/images/logo.png'],
      },
    }),
  );
}

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

// --- public surface ------------------------------------------------------
const TokenomicWeb3 = {
  // config + identity
  config,
  chains: { base, baseSepolia },
  defaultChain: base,
  USDC_BASE,
  USDC_BASE_SEPOLIA,
  WC_PROJECT_ID,
  // connectors (call as functions to instantiate)
  connectors: { injected, walletConnect, coinbaseWallet },
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
