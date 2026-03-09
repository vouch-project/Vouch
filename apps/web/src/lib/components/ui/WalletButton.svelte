<script lang="ts">
  /**
   * WalletButton — primary connect / account toggle button.
   *
   * - Disconnected: "Connect Wallet" → opens the AppKit connection modal.
   * - Connecting:   disabled spinner button while the modal is loading.
   * - Connected:    shows the truncated address → opens the Account view.
   *
   * Actions are deferred to the browser via dynamic import so that this
   * component remains fully SSR-safe.
   */
  import { shortAddress, walletAddress, walletIsConnected, walletIsLoading } from '$lib/wallet/store';

  async function openConnectModal() {
    const { getAppKit } = await import('$lib/wallet/appkit');
    getAppKit()?.open();
  }

  async function openAccountModal() {
    const { getAppKit } = await import('$lib/wallet/appkit');
    getAppKit()?.open({ view: 'Account' });
  }

  function handleClick() {
    if ($walletIsConnected) {
      openAccountModal();
    } else {
      openConnectModal();
    }
  }
</script>

<button
  class="wallet-btn"
  class:connected={$walletIsConnected}
  class:loading={$walletIsLoading}
  onclick={handleClick}
  disabled={$walletIsLoading}
  aria-label={$walletIsConnected ? `Wallet: ${$walletAddress ?? ''}` : 'Connect Wallet'}
>
  {#if $walletIsLoading}
    <span class="spinner" aria-hidden="true"></span>
    <span>Connecting…</span>
  {:else if $walletIsConnected}
    <span class="status-dot" aria-hidden="true"></span>
    <span>{$shortAddress}</span>
  {:else}
    <span>Connect Wallet</span>
  {/if}
</button>

<style>
  .wallet-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1.125rem;
    border: 1.5px solid #d1d5db;
    border-radius: 0.625rem;
    background: #fff;
    font-size: 0.875rem;
    font-weight: 600;
    color: #111827;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
    white-space: nowrap;
  }

  .wallet-btn:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  .wallet-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  /* Connected state */
  .wallet-btn.connected {
    border-color: #16a34a;
    color: #15803d;
  }

  .wallet-btn.connected:hover:not(:disabled) {
    background: #f0fdf4;
    border-color: #15803d;
  }

  /* Loading state */
  .wallet-btn.loading {
    border-color: #6366f1;
    color: #4f46e5;
  }

  /* Green "online" dot shown when connected */
  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #16a34a;
    flex-shrink: 0;
  }

  /* CSS-only spinner */
  .spinner {
    display: inline-block;
    width: 0.875rem;
    height: 0.875rem;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
