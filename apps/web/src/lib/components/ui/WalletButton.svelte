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

  const btnClass = $derived(
    [
      'inline-flex items-center gap-2 px-[1.125rem] py-2 border-[1.5px] rounded-[0.625rem] bg-white text-sm font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap disabled:opacity-65 disabled:cursor-not-allowed',
      $walletIsConnected
        ? 'border-green-600 text-green-700 hover:bg-green-50 hover:border-green-700'
        : $walletIsLoading
          ? 'border-indigo-400 text-indigo-600'
          : 'border-gray-300 text-gray-900 hover:bg-gray-100 hover:border-gray-400',
    ].join(' '),
  );
</script>

<button
  class={btnClass}
  onclick={handleClick}
  disabled={$walletIsLoading}
  aria-label={$walletIsConnected ? `Wallet: ${$walletAddress ?? ''}` : 'Connect Wallet'}
>
  {#if $walletIsLoading}
    <span
      class="inline-block w-[0.875rem] h-[0.875rem] border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0"
      aria-hidden="true"
    ></span>
    <span>Connecting…</span>
  {:else if $walletIsConnected}
    <span class="w-2 h-2 rounded-full bg-green-600 flex-shrink-0" aria-hidden="true"></span>
    <span>{$shortAddress}</span>
  {:else}
    <span>Connect Wallet</span>
  {/if}
</button>
