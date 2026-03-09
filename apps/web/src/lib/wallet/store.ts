/**
 * Svelte stores that mirror Reown AppKit wallet state.
 *
 * Import these stores in any component to reactively display wallet
 * information.  The stores are plain Svelte writables so they are fully
 * SSR-safe – no browser APIs are called at module initialisation time.
 *
 * Call `initWalletSubscriptions(modal)` once (in the root layout's `onMount`)
 * to wire the stores to the live AppKit instance.
 */
import type { AppKit } from '@reown/appkit';
import { derived, writable } from 'svelte/store';

// ---------------------------------------------------------------------------
// Raw state stores
// ---------------------------------------------------------------------------

/** The connected wallet address, or undefined when disconnected. */
export const walletAddress = writable<string | undefined>(undefined);

/** The chain ID of the currently selected network, or undefined. */
export const walletChainId = writable<number | undefined>(undefined);

/** Whether a wallet is actively connected. */
export const walletIsConnected = writable(false);

/** Whether the AppKit modal is loading / processing a connection. */
export const walletIsLoading = writable(false);

/** Whether the AppKit modal overlay is open. */
export const walletIsModalOpen = writable(false);

// ---------------------------------------------------------------------------
// Derived / computed stores
// ---------------------------------------------------------------------------

/**
 * A shortened display form of the wallet address, e.g. `0x1234…abcd`.
 * Returns an empty string when disconnected.
 */
export const shortAddress = derived(walletAddress, ($address) => {
  if (!$address) return '';
  return `${$address.slice(0, 6)}\u2026${$address.slice(-4)}`;
});

/** Human-readable name for the currently connected network. */
export const networkName = derived(walletChainId, ($chainId) => {
  const NAMES: Record<number, string> = {
    1: 'Ethereum',
    11155111: 'Sepolia',
    137: 'Polygon',
    42161: 'Arbitrum',
    31337: 'Localhost',
  };
  if (!$chainId) return '';
  return NAMES[$chainId] ?? `Chain ${$chainId}`;
});

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Subscribe to AppKit events and sync them into the Svelte stores.
 * Must be called exactly once, inside `onMount`, after `getAppKit()` returns
 * a non-null instance.
 *
 * Returns an unsubscribe function that cancels all subscriptions.
 */
export function initWalletSubscriptions(modal: AppKit): () => void {
  const unsubAccount = modal.subscribeAccount((account) => {
    walletAddress.set(account.address);
    walletIsConnected.set(account.isConnected);
  });

  const unsubNetwork = modal.subscribeNetwork((network) => {
    walletChainId.set(network.chainId ? Number(network.chainId) : undefined);
  });

  const unsubState = modal.subscribeState((state) => {
    walletIsLoading.set(state.loading ?? false);
    walletIsModalOpen.set(state.open ?? false);
  });

  return () => {
    unsubAccount();
    unsubNetwork();
    unsubState();
  };
}
