<script lang="ts">
  import { resolve } from '$app/paths';
  import WalletButton from '$lib/components/ui/WalletButton.svelte';
  import ModeToggle from '$lib/components/ui/ModeToggle.svelte';

  let menuOpen = $state(false);

  import { Menu, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { navLinks, navLinksMap } from '$lib/navLinks';
  import { page } from '$app/state';
  const url = $derived(page.url);
</script>

<header class="border-b border-border bg-background sticky top-0 z-50 transition-colors">
  <div class="flex items-center py-3.5 px-8">
    <a
      class="group inline-flex items-center gap-2 no-underline text-foreground flex-1"
      aria-label="Vouch – home"
      href={resolve(navLinksMap.Home, {})}
    >
      <img
        class="inline-flex items-center justify-center w-8 h-8 rounded-lg"
        alt="Vouch logo"
        aria-hidden="true"
        draggable="false"
        src="/favicon.svg"
      />
      <span class="text-[1.2rem] font-bold tracking-[-0.02em]">Vouch</span>
    </a>

    <!-- Desktop nav -->
    <nav class="hidden sm:flex gap-4 items-center" aria-label="Main navigation">
      {#each navLinks as link (link.href)}
        {@const resolvedHref = resolve(link.href, {})}
        {@const isActive = url.pathname === resolvedHref}
        <a
          class="no-underline text-sm font-medium transition-all duration-200 px-3 py-1.5 rounded-full {isActive
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
          href={resolvedHref}
        >
          {link.label}
        </a>
      {/each}
    </nav>

    <div class="flex items-center justify-end gap-3 flex-1">
      <ModeToggle />
      <WalletButton />
      <!-- Hamburger — mobile only -->
      <Button
        class="sm:hidden"
        aria-expanded={menuOpen}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onclick={() => (menuOpen = !menuOpen)}
        size="icon"
        variant="ghost"
      >
        {#if menuOpen}
          <X class="h-5 w-5" />
        {:else}
          <Menu class="h-5 w-5" />
        {/if}
      </Button>
    </div>
  </div>

  <!-- Mobile dropdown -->
  {#if menuOpen}
    <nav class="sm:hidden flex flex-col border-t border-border px-8 py-3 gap-1" aria-label="Mobile navigation">
      {#each navLinks as link (link.href)}
        {@const resolvedHref = resolve(link.href, {})}
        {@const isActive = url.pathname === resolvedHref}
        <a
          class="no-underline text-sm font-medium py-2 px-2 rounded-md transition-all duration-200 {isActive
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
          href={resolvedHref}
          onclick={() => (menuOpen = false)}
        >
          {link.label}
        </a>
      {/each}
    </nav>
  {/if}
</header>
