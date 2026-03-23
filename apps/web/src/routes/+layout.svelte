<script lang="ts">
  /**
   * Root layout — mounts the AppKit modal once and wires Svelte stores.
   *
   * AppKit is browser-only, so the import is done inside `onMount` to avoid
   * any SSR issues.  All child routes can then import `$lib/wallet/store`
   * stores and see live, reactive wallet state.
   */
  import Header from '$lib/components/layout/Header.svelte';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { initWalletSubscriptions, wallet } from '$lib/wallet/wallet.svelte';
  import { onMount } from 'svelte';
  import { getChainInfo } from '../api/chain';
  import '../app.css';

  const { children } = $props();

  onMount(async () => {
    // Dynamic import keeps AppKit (and its browser-only polyfills) out of SSR.
    const { getAppKit } = await import('$lib/wallet/appkit');
    const modal = getAppKit();
    if (modal) initWalletSubscriptions(modal);
  });

  $effect(() => {
    const fetchTokens = async () => {
      try {
        if (wallet.networkId) {
          const chainData = await getChainInfo(wallet.networkId);
          chainInfo.contractAddress = chainData.contractAddress;
          chainInfo.tokens = chainData.tokens;
        } else {
          chainInfo.contractAddress = undefined;
          chainInfo.tokens = [];
        }
      } catch (e) {
        console.error('Failed to fetch token list', e);
        chainInfo.contractAddress = undefined;
        chainInfo.tokens = [];
      }
    };

    void fetchTokens();
  });
</script>

<Header />

<main class="min-h-[calc(100vh-57px)] p-8 max-w-[1200px] mx-auto">
  {@render children()}
</main>
