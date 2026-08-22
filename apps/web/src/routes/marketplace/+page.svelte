<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs';
  import { ShieldCheck } from '@lucide/svelte';
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
    <p class="text-xl text-muted-foreground font-medium">Secure peer-to-peer lending with collateralized protection.</p>
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
</div>
