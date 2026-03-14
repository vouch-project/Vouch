/**
 * Reown AppKit (Web3Modal) initialization for Vouch.
 *
 * This module is safe to import on the server – the AppKit instance is only
 * created when running in the browser (guarded by the `browser` check). All
 * calling code that interacts with the modal (open, disconnect, etc.) must
 * therefore be executed client-side (e.g. inside onMount or event handlers).
 */
import { browser, dev } from '$app/environment';
import { PUBLIC_REOWN_PROJECT_ID } from '$lib/env';
import type { AppKit } from '@reown/appkit';
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { arbitrum, localhost, mainnet, polygon, sepolia } from '@reown/appkit/networks';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const projectId = PUBLIC_REOWN_PROJECT_ID ?? '';

/**
 * Networks the app supports, in priority order.
 * LocalHost (chain 31337) is added when running in development mode so that
 * testers can connect to the local Hardhat node started by docker-compose.
 */
export const SUPPORTED_NETWORKS: Parameters<typeof createAppKit>[0]['networks'] = dev
  ? [localhost, mainnet, sepolia, polygon, arbitrum]
  : [mainnet, sepolia, polygon, arbitrum];
export const DEFAULT_NETWORK = dev ? localhost : mainnet;

// ---------------------------------------------------------------------------
// Singleton modal instance
// ---------------------------------------------------------------------------

let _modal: AppKit | undefined;

/**
 * Returns the AppKit modal singleton.
 * Returns `undefined` on the server or when the project ID is missing.
 */
export const getAppKit = (): AppKit | undefined => {
  if (!browser) return undefined;

  if (!projectId) {
    console.warn(
      '[Vouch] PUBLIC_REOWN_PROJECT_ID is not set – wallet features are disabled. ' +
        'Get a free project ID at https://cloud.reown.com',
    );
    return undefined;
  }

  if (_modal) return _modal;

  _modal = createAppKit({
    adapters: [new EthersAdapter()],
    projectId,
    networks: SUPPORTED_NETWORKS,
    defaultNetwork: DEFAULT_NETWORK,
    metadata: {
      name: 'Vouch',
      description: 'Decentralized P2P Crypto Lending',
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.png`],
    },
    features: {
      // Disable e-mail / social login – keep the experience to on-chain wallets
      email: false,
      socials: false,
      analytics: true,
    },
  });

  return _modal;
};
