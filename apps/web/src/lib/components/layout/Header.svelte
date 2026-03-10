<script lang="ts">
  import WalletButton from '$lib/components/ui/WalletButton.svelte';
</script>

<header
  class="flex items-center justify-between py-[0.875rem] px-8 border-b border-gray-200 bg-white sticky top-0 z-50"
>
  <a
    href="/"
    class="group inline-flex items-center gap-2 no-underline text-gray-900 flex-shrink-0"
    aria-label="Vouch – home"
  >
    <span
      class="inline-flex items-center justify-center w-8 h-8 bg-gray-900 text-white rounded-lg font-extrabold text-base transition-colors duration-150 group-hover:bg-gray-700"
      aria-hidden="true">V</span
    >
    <span class="text-[1.2rem] font-bold tracking-[-0.02em]">Vouch</span>
  </a>

  <nav class="hidden sm:flex gap-7" aria-label="Main navigation">
    <a
      href="/"
      class="no-underline text-gray-500 text-sm font-medium transition-colors duration-[120ms] hover:text-gray-900"
      >Home</a
    >
    <a
      href="/dashboard"
      class="no-underline text-gray-500 text-sm font-medium transition-colors duration-[120ms] hover:text-gray-900"
      >Dashboard</a
    >
    <a
      href="/borrow"
      class="no-underline text-gray-500 text-sm font-medium transition-colors duration-[120ms] hover:text-gray-900"
      >Borrow</a
    >
    <a
      href="/lend"
      class="no-underline text-gray-500 text-sm font-medium transition-colors duration-[120ms] hover:text-gray-900"
      >Lend</a
    >
  </nav>

  <div class="flex items-center gap-3 flex-shrink-0">
    <WalletButton />
  </div>
</header>
