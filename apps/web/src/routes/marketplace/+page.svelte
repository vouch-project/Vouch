<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import * as Tabs from '$lib/components/ui/tabs';
  import { cn } from '$lib/utils';
  import { ShieldCheck, TrendingUp, Zap } from '@lucide/svelte';
  import BorrowTab from './BorrowTab.svelte';
  import LendTab from './LendTab.svelte';

  let { data } = $props();
  let activeTab: string = $state('borrow');
</script>

<svelte:head>
  <title>Marketplace | Vouch</title>
</svelte:head>

<div class="w-full py-8 space-y-8 animate-in fade-in duration-700">
  <div class="space-y-2">
    <h1
      class="text-4xl font-extrabold tracking-tight lg:text-5xl bg-linear-to-r from-gray-900 via-gray-700 to-gray-500 dark:from-white dark:via-gray-200 dark:to-gray-400 bg-clip-text text-transparent"
    >
      Marketplace
    </h1>
    <p class="text-xl text-muted-foreground font-medium">
      Secure peer-to-peer lending with collateralized protection.
    </p>
  </div>

  <Tabs.Root class="w-full" bind:value={activeTab}>
    <div class="flex items-center justify-between mb-6">
      <Tabs.List class="bg-muted/50 p-1">
        <Tabs.Trigger class="px-8 font-semibold" value="borrow">Borrow Requests</Tabs.Trigger>
        <Tabs.Trigger class="px-8 font-semibold" value="lend">Lend Offers</Tabs.Trigger>
      </Tabs.List>

      <div class="hidden sm:flex items-center gap-4 text-sm text-muted-foreground italic">
        <ShieldCheck class="h-4 w-4 text-green-500" />
        All loans are collateralized
      </div>
    </div>

    <Tabs.Content value="borrow">
      <BorrowTab {data} />
    </Tabs.Content>

    <Tabs.Content value="lend">
      <LendTab />
    </Tabs.Content>
  </Tabs.Root>

  <!-- Ecosystem Stats Footer -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
    {#each [
      { label: 'Total Value Locked', value: '$1.2M', icon: ShieldCheck, color: 'text-green-500' },
      { label: 'Avg. Market APY', value: '12.4%', icon: TrendingUp, color: 'text-blue-500' },
      { label: 'Loans Protected', value: '142', icon: Zap, color: 'text-amber-500' },
    ] as stat (stat.label)}
      <Card.Root class="bg-muted/10 border-none shadow-none p-4 flex items-center gap-4">
        <div
          class="h-10 w-10 rounded-xl bg-background flex items-center justify-center shadow-sm border border-border/20"
        >
          <stat.icon class={cn('h-5 w-5', stat.color)} />
        </div>
        <div>
          <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</p>
          <p class="text-lg font-black text-foreground">{stat.value}</p>
        </div>
      </Card.Root>
    {/each}
  </div>
</div>
