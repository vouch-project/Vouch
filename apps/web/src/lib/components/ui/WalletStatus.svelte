<script lang="ts">
  /**
   * WalletStatus — detailed panel shown when a wallet is connected.
   *
   * Displays the current address (click to copy) and the active network.
   * Provides a disconnect action.
   */
  import { networkName, shortAddress, walletAddress, walletIsConnected } from '$lib/wallet/store';

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout>;

  function copyAddress() {
    if (!$walletAddress) return;
    navigator.clipboard.writeText($walletAddress).then(() => {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    });
  }

  async function disconnect() {
    const { getAppKit } = await import('$lib/wallet/appkit');
    await getAppKit()?.disconnect();
  }
</script>

{#if $walletIsConnected}
  <div
    class="flex flex-col gap-[0.875rem] p-[1.125rem] border border-gray-200 rounded-[0.875rem] bg-white shadow-sm min-w-[220px]"
    role="region"
    aria-label="Connected wallet"
  >
    <div class="flex items-center justify-between gap-4">
      <span class="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-gray-500">Address</span>
      <button
        class="inline-flex items-center gap-[0.375rem] px-2 py-1 bg-gray-50 border border-gray-200 rounded-md cursor-pointer text-[0.8rem] text-gray-900 transition-colors duration-100 hover:bg-gray-100"
        onclick={copyAddress}
        title={copied ? 'Copied!' : 'Click to copy address'}
        aria-label={copied ? 'Address copied' : 'Copy wallet address'}
      >
        <span class="font-mono">{$shortAddress}</span>
        <span class="text-xs text-gray-400" aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      </button>
    </div>

    {#if $networkName}
      <div class="flex items-center justify-between gap-4">
        <span class="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-gray-500">Network</span>
        <span class="text-xs font-semibold px-[0.625rem] py-1 rounded-full bg-blue-50 text-blue-700 tracking-[0.02em]"
          >{$networkName}</span
        >
      </div>
    {/if}

    <button
      class="self-start px-[0.875rem] py-[0.4rem] border border-red-300 rounded-lg bg-transparent text-red-600 text-[0.8rem] font-semibold cursor-pointer transition-colors duration-100 hover:bg-red-50"
      onclick={disconnect}
    >
      Disconnect
    </button>
  </div>
{/if}
