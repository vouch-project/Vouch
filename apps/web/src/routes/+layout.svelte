<script lang="ts">
  /**
   * Root layout — mounts the AppKit modal once and wires Svelte stores.
   *
   * AppKit is browser-only, so the import is done inside `onMount` to avoid
   * any SSR issues.  All child routes can then import `$lib/wallet/store`
   * stores and see live, reactive wallet state.
   */
  import Header from '$lib/components/layout/Header.svelte';
  import { initWalletSubscriptions } from '$lib/wallet/store';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(async () => {
    // Dynamic import keeps AppKit (and its browser-only polyfills) out of SSR.
    const { getAppKit } = await import('$lib/wallet/appkit');
    const modal = getAppKit();
    if (modal) {
      initWalletSubscriptions(modal);
    }
  });
</script>

<Header />

<main>
  {@render children()}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    background: #f9fafb;
    color: #111827;
    -webkit-font-smoothing: antialiased;
  }

  :global(a) {
    color: inherit;
  }

  main {
    min-height: calc(100vh - 57px);
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
