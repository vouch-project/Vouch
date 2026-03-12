<script lang="ts">
  import { resolve } from '$app/paths';
  import WalletButton from '$lib/components/ui/WalletButton.svelte';
  import WalletStatus from '$lib/components/ui/WalletStatus.svelte';
  import { navLinksMap } from '$lib/navLinks';
  import { walletIsConnected } from '$lib/wallet/store';
</script>

<section class="text-center pt-16 pb-12 px-4">
  <div
    class="inline-block py-[0.3rem] px-[0.875rem] rounded-full bg-blue-50 text-blue-700 text-xs font-bold tracking-[0.05em] uppercase mb-5"
  >
    Decentralized P2P Lending
  </div>
  <h1 class="text-[clamp(2rem,5vw,3.25rem)] font-extrabold leading-[1.15] tracking-[-0.03em] mb-5 text-gray-900">
    Borrow &amp; Lend Crypto<br />with <span class="text-indigo-600">On-Chain Trust</span>
  </h1>
  <p class="max-w-[540px] mx-auto mb-8 text-gray-500 text-[1.0625rem] leading-relaxed">
    Vouch lets you lend and borrow digital assets backed by verifiable on-chain collateral. Connect your wallet to get
    started.
  </p>

  <div class="flex items-center justify-center gap-4 flex-wrap mb-7">
    <WalletButton />
    {#if $walletIsConnected}
      <a
        href={resolve(navLinksMap.Dashboard)}
        class="text-[0.9rem] font-semibold text-indigo-600 no-underline hover:underline">Go to Dashboard →</a
      >
    {/if}
  </div>

  {#if $walletIsConnected}
    <div class="inline-block mt-2">
      <WalletStatus />
    </div>
  {:else}
    <p class="text-[0.8rem] text-gray-400 mt-1">
      Supports MetaMask, WalletConnect, Coinbase Wallet, and 300+ more via Web3Modal.
    </p>
  {/if}
</section>

<section class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5 mt-12">
  <div class="bg-white border border-gray-200 rounded-2xl p-6 text-left">
    <span class="text-[1.75rem] block mb-3">🔒</span>
    <h3 class="text-base font-bold mb-[0.375rem] text-gray-900">Non-Custodial</h3>
    <p class="text-sm text-gray-500 leading-relaxed">Your keys, your coins. Vouch never holds your funds.</p>
  </div>
  <div class="bg-white border border-gray-200 rounded-2xl p-6 text-left">
    <span class="text-[1.75rem] block mb-3">⚡</span>
    <h3 class="text-base font-bold mb-[0.375rem] text-gray-900">On-Chain Credit</h3>
    <p class="text-sm text-gray-500 leading-relaxed">Credit scores powered by verifiable on-chain history.</p>
  </div>
  <div class="bg-white border border-gray-200 rounded-2xl p-6 text-left">
    <span class="text-[1.75rem] block mb-3">🌐</span>
    <h3 class="text-base font-bold mb-[0.375rem] text-gray-900">Multi-Chain</h3>
    <p class="text-sm text-gray-500 leading-relaxed">Ethereum, Polygon, and Arbitrum supported out of the box.</p>
  </div>
</section>
