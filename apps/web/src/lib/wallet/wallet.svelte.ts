/**
 * Svelte module that mirrors Reown AppKit wallet state as plain exported variables.
 *
 * Import these variables in any component to access wallet information.
 * Call `initWalletSubscriptions(modal)` once (in the root layout's `onMount`)
 * to wire the variables to the live AppKit instance.
 */

import type { AppKit } from '@reown/appkit';

// ---------------------------------------------------------------------------
// Raw state variables
// ---------------------------------------------------------------------------

class WalletState {
  address = $state<string | undefined>(undefined);
  chainId = $state<number | undefined>(undefined);
  isConnected = $state(false);
  isLoading = $state(false);
  isModalOpen = $state(false);

  /**
   * A shortened display form of the wallet address, e.g. `0x1234…abcd`.
   * Returns an empty string when disconnected.
   */
  get shortAddress() {
    if (!this.address) return '';
    return `${this.address.slice(0, 6)}\u2026${this.address.slice(-4)}`;
  }

  /** Human-readable name for the currently connected network. */
  get networkName() {
    const NAMES: Record<number, string> = {
      1: 'Ethereum',
      11155111: 'Sepolia',
      137: 'Polygon',
      42161: 'Arbitrum',
      1337: 'Localhost',
    };

    if (!this.chainId) return '';
    return NAMES[this.chainId] ?? `Chain ${this.chainId}`;
  }
}

export const wallet = new WalletState();

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Subscribe to AppKit events and sync them into the exported variables.
 * Must be called exactly once, inside `onMount`, after `getAppKit()` returns
 * a non-null instance.
 *
 * Returns an unsubscribe function that cancels all subscriptions.
 */
export const initWalletSubscriptions = (modal: AppKit): (() => void) => {
  const unsubAccount = modal.subscribeAccount((account) => {
    wallet.address = account.address;
    wallet.isConnected = account.isConnected;
  });

  const unsubNetwork = modal.subscribeNetwork((network) => {
    wallet.chainId = network.chainId ? Number(network.chainId) : undefined;
  });

  const unsubState = modal.subscribeState((state) => {
    wallet.isLoading = state.loading ?? false;
    wallet.isModalOpen = state.open ?? false;
  });

  return () => {
    unsubAccount();
    unsubNetwork();
    unsubState();
  };
};
