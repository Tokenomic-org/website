/**
 * Heavy wallet connectors, split out of the eager web3 bundle.
 *
 * Bundled by esbuild into shared/assets/js/web3-connectors.js and fetched
 * with a dynamic import() only when a visitor actually chooses WalletConnect
 * or Coinbase Wallet — see TokenomicWeb3.ensureConnector() in
 * web3-bundle-src.js.
 *
 * Why these two and not `injected`: measured minified, alone,
 *
 *   @wagmi/core + injected + viem   320K   (stays eager)
 *   coinbaseWallet                  1.1M   (here)
 *   walletConnect                   1.3M   (here)
 *
 * The injected connector is what `reconnect()` needs to silently restore a
 * MetaMask/Rabby/Brave session on load, and it is cheap, so it stays in the
 * eager bundle. These two are only reachable behind a deliberate click.
 *
 * Build-time defines (esbuild --define), same as the main bundle:
 *   process.env.WC_PROJECT_ID   WalletConnect Cloud project id
 */

import { walletConnect, coinbaseWallet } from '@wagmi/connectors';

const WC_PROJECT_ID =
  (typeof process !== 'undefined' && process.env && process.env.WC_PROJECT_ID) || '';

/**
 * Build the connector factory for a given kind, or null when it cannot be
 * configured. Config values are kept identical to the pre-split bundle so
 * connector ids, branding and behaviour do not change.
 */
export function connectorFor(kind) {
  if (kind === 'coinbase-smart' || kind === 'coinbaseWallet') {
    return coinbaseWallet({
      appName: 'Tokenomic',
      appLogoUrl: 'https://tokenomic.org/assets/images/logo.png',
      preference: 'all', // EOA wallet OR Smart Wallet (passkey)
    });
  }
  if (kind === 'walletconnect' || kind === 'walletConnect') {
    // Without a project id WalletConnect cannot initialise. Return null so the
    // caller can surface the same "not configured" message it always has,
    // rather than throwing from inside a dynamic import.
    if (!WC_PROJECT_ID) return null;
    return walletConnect({
      projectId: WC_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: 'Tokenomic',
        description: 'Institutional DeFi education on Base',
        url: 'https://tokenomic.org',
        icons: ['https://tokenomic.org/assets/images/logo.png'],
      },
    });
  }
  return null;
}

export { walletConnect, coinbaseWallet, WC_PROJECT_ID };
