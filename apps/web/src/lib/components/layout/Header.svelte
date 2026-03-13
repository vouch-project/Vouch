<script lang="ts">
  import { resolve } from '$app/paths';
  import WalletButton from '$lib/components/ui/WalletButton.svelte';

  let menuOpen = $state(false);

  import { navLinks, navLinksMap } from '$lib/navLinks';
</script>

<header class="border-b border-gray-200 bg-white sticky top-0 z-50">
  <div class="flex items-center py-[0.875rem] px-8">
    <a
      class="group inline-flex items-center gap-2 no-underline text-gray-900 flex-1"
      aria-label="Vouch – home"
      href={resolve(navLinksMap.Home)}
    >
      <span
        class="inline-flex items-center justify-center w-8 h-8 bg-gray-900 text-white rounded-lg font-extrabold text-base transition-colors duration-150 group-hover:bg-gray-700"
        aria-hidden="true"
      >
        V
      </span>
      <span class="text-[1.2rem] font-bold tracking-[-0.02em]">Vouch</span>
    </a>

    <!-- Desktop nav -->
    <nav class="hidden sm:flex gap-7" aria-label="Main navigation">
      {#each navLinks as link (link.href)}
        <a
          class="no-underline text-gray-500 text-sm font-medium transition-colors duration-[120ms] hover:text-gray-900"
          href={resolve(link.href)}
        >
          {link.label}
        </a>
      {/each}
    </nav>

    <div class="flex items-center justify-end gap-3 flex-1">
      <WalletButton />
      <!-- Hamburger — mobile only -->
      <button
        class="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
        aria-expanded={menuOpen}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onclick={() => (menuOpen = !menuOpen)}
        type="button"
      >
        {#if menuOpen}
          <svg
            fill="none"
            height="20"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
            width="20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="18" x2="6" y1="6" y2="18" />
            <line x1="6" x2="18" y1="6" y2="18" />
          </svg>
        {:else}
          <svg
            fill="none"
            height="20"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
            width="20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="3" x2="21" y1="12" y2="12" />
            <line x1="3" x2="21" y1="6" y2="6" />
            <line x1="3" x2="21" y1="18" y2="18" />
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <!-- Mobile dropdown -->
  {#if menuOpen}
    <nav class="sm:hidden flex flex-col border-t border-gray-100 px-8 py-3 gap-1" aria-label="Mobile navigation">
      {#each navLinks as link (link.href)}
        <a
          class="no-underline text-gray-600 text-sm font-medium py-2 hover:text-gray-900 transition-colors"
          href={resolve(link.href)}
          onclick={() => (menuOpen = false)}
        >
          {link.label}
        </a>
      {/each}
    </nav>
  {/if}
</header>
