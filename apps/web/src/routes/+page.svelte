<script lang="ts">
  import { resolve } from '$app/paths';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import WalletButton from '$lib/components/ui/WalletButton.svelte';
  import WalletStatus from '$lib/components/ui/WalletStatus.svelte';
  import { navLinksMap } from '$lib/navLinks';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { ArrowRight, ShieldCheck, TrendingUp, Zap } from '@lucide/svelte';
  import type { ProtocolStats } from './+page';

  let { data } = $props();

  const formatUsd = (value: number): string => {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  };

  const statItems = (stats: ProtocolStats) => [
    { label: 'Total Value Locked', value: formatUsd(stats.tvlUsd), icon: ShieldCheck, color: 'text-green-500' },
    { label: 'Total Borrowed', value: formatUsd(stats.totalBorrowedUsd), icon: TrendingUp, color: 'text-blue-500' },
    { label: 'Active Loans', value: String(stats.activeLoansCount), icon: Zap, color: 'text-amber-500' },
  ];
</script>

<svelte:head>
  <title>Vouch</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[80vh] space-y-20 py-12 px-4">
  <section class="max-w-[800px] text-center space-y-8 animate-in fade-in duration-700">
    <div class="flex flex-col items-center space-y-4">
      <Badge
        class="py-1 px-4 text-xs font-bold tracking-widest uppercase bg-primary/10 text-primary border-primary/20 cursor-default"
        variant="outline"
      >
        Decentralized P2P Lending
      </Badge>

      <h1 class="text-5xl md:text-7xl font-black leading-[1.05] tracking-tight text-foreground">
        Borrow & Lend Crypto<br />
        <span class="bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
          with On-Chain Trust
        </span>
      </h1>

      <p class="max-w-[600px] mx-auto text-xl text-muted-foreground font-medium leading-relaxed">
        Vouch lets you lend and borrow digital assets backed by verifiable on-chain collateral. Secure, transparent, and
        built for the future of finance.
      </p>
    </div>

    <div class="flex flex-col items-center space-y-6">
      <div class="flex items-center justify-center gap-4 flex-wrap">
        <WalletButton />
        {#if wallet.isConnected}
          <a
            class="group inline-flex items-center text-sm font-bold text-primary hover:text-primary/80 transition-colors"
            href={resolve(navLinksMap.Dashboard, {})}
          >
            Go to Dashboard
            <ArrowRight class="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
        {/if}
      </div>

      {#if wallet.isConnected}
        <div class="animate-in fade-in zoom-in duration-500">
          <WalletStatus />
        </div>
      {:else}
        <p class="text-sm text-muted-foreground/60 font-medium">
          Supports MetaMask, WalletConnect, Coinbase Wallet, and 300+ more via Web3Modal.
        </p>
      {/if}
    </div>
  </section>

  <section class="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-[1100px] animate-in fade-in duration-1000 delay-300">
    {#await data.streamed.statsPromise}
      {#each Array(3) as _, i (i)}
        <Card.Root class="bg-muted/10 border-none shadow-none p-6 flex flex-col items-center justify-center gap-3">
          <div class="h-10 w-10 rounded-xl bg-background flex items-center justify-center shadow-sm border border-border/20">
            <div class="h-5 w-5 rounded bg-muted animate-pulse"></div>
          </div>
          <div class="space-y-2 flex flex-col items-center">
            <div class="h-3 w-20 bg-muted animate-pulse rounded"></div>
            <div class="h-5 w-16 bg-muted animate-pulse rounded"></div>
          </div>
        </Card.Root>
      {/each}
    {:then stats}
      {#each statItems(stats) as stat (stat.label)}
        <Card.Root class="bg-muted/10 border-none shadow-none p-6 flex flex-col items-center justify-center gap-3 text-center">
          <div class="h-10 w-10 rounded-xl bg-background flex items-center justify-center shadow-sm border border-border/20">
            <stat.icon class="h-5 w-5 {stat.color}" />
          </div>
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</p>
            <p class="text-lg font-black text-foreground">{stat.value}</p>
          </div>
        </Card.Root>
      {/each}
    {:catch}
      {#each Array(3) as _, i (i)}
        <Card.Root class="bg-muted/10 border-none shadow-none p-6 flex flex-col items-center justify-center gap-3">
          <div class="h-10 w-10 rounded-xl bg-background flex items-center justify-center shadow-sm border border-border/20">
            <div class="h-5 w-5 rounded bg-destructive/20"></div>
          </div>
          <div class="space-y-2 flex flex-col items-center">
            <div class="h-3 w-20 bg-muted rounded"></div>
            <div class="h-5 w-16 bg-muted rounded"></div>
          </div>
        </Card.Root>
      {/each}
    {/await}
  </section>
</div>
