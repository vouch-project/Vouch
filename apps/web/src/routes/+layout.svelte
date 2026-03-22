<script lang="ts">
  /**
   * Root layout — mounts the AppKit modal once and wires Svelte stores.
   *
   * AppKit is browser-only, so the import is done inside `onMount` to avoid
   * any SSR issues.  All child routes can then import `$lib/wallet/store`
   * stores and see live, reactive wallet state.
   */
  import Header from '$lib/components/layout/Header.svelte';
  import { navigating } from '$app/stores';
  import { tokenListStore } from '$lib/stores/tokenListStore.svelte';
  import { initWalletSubscriptions, wallet } from '$lib/wallet/wallet.svelte';
  import { onMount } from 'svelte';
  import { getTokenList } from '../api/tokenList';
  import '../app.css';

  const { children } = $props();

  let isLoading = $state(false);
  let isFinishing = $state(false);

  $effect(() => {
    if ($navigating) {
      isLoading = true;
      isFinishing = false;
    } else if (isLoading && !isFinishing) {
      isFinishing = true;
      setTimeout(() => {
        isLoading = false;
        isFinishing = false;
      }, 300);
    }
  });

  onMount(async () => {
    // Dynamic import keeps AppKit (and its browser-only polyfills) out of SSR.
    const { getAppKit } = await import('$lib/wallet/appkit');
    const modal = getAppKit();
    if (modal) initWalletSubscriptions(modal);
  });

  $effect(() => {
    const fetchTokens = async () => {
      try {
        if (wallet.chainId) {
          const tokens = await getTokenList(wallet.chainId);
          tokenListStore.tokens = tokens;
        } else {
          console.warn('No chain ID found in wallet; skipping token list fetch');
        }
      } catch (e) {
        console.error('Failed to fetch token list', e);
      }
    };

    void fetchTokens();
  });
</script>

{#if isLoading}
  <div
    class="fixed top-0 left-0 z-100 h-[3px] bg-blue-600 drop-shadow-sm transition-all duration-300 ease-out pointer-events-none"
    class:animate-loading-progress={!isFinishing}
    class:opacity-0={isFinishing}
    class:opacity-100={!isFinishing}
    class:w-full={isFinishing}
  ></div>
{/if}

<Header />

<main class="min-h-[calc(100vh-57px)] p-8 max-w-[1200px] mx-auto">
  {@render children()}
</main>
