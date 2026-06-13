<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import LoanRepayCard from '$lib/components/ui/LoanRepayCard.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { supabase } from '$lib/supabase';
  import type { LoanFull } from '$lib/types';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { LayoutDashboard, RefreshCw, WalletMinimal } from '@lucide/svelte';
  import type { Address } from '@vouch/database-types';
  import { ethers } from 'ethers';

  // ── Data fetching ─────────────────────────────────────────────────────────
  let loans = $state<LoanFull[]>([]);
  let loading = $state(false);
  let fetchError = $state('');

  const fetchLoans = async () => {
    if (!wallet.address) return;
    loading = true;
    fetchError = '';

    const { data, error } = await supabase
      .from('loans')
      .select(
        `
        *,
        collateralToken:tokens!loans_collateralTokenId_fkey(*),
        principalToken:tokens!loans_principalTokenId_fkey(*),
        repaymentTransactions:transactions!transactions_loanId_fkey(id, amount, txTimestamp, txHash, type)
      `,
      )
      .eq('borrowerAddress', ethers.getAddress(wallet.address) as Address)
      .order('createdAt', { ascending: false });

    loading = false;
    if (error) {
      fetchError = error.message;
      return;
    }
    loans = (data ?? []) as unknown as LoanFull[];
  };

  $effect(() => {
    void fetchLoans();
  });

  // ── Filtering ─────────────────────────────────────────────────────────────
  type Filter = 'active' | 'repaid' | 'all';
  let filter = $state<Filter>('active');

  const filteredLoans = $derived.by(() => {
    if (filter === 'active') return loans.filter((l) => l.status === 'active' || l.status === 'pending');
    if (filter === 'repaid') return loans.filter((l) => l.status === 'repaid');
    return loans;
  });

  const activeCnt = $derived(loans.filter((l) => l.status === 'active' || l.status === 'pending').length);
  const repaidCnt = $derived(loans.filter((l) => l.status === 'repaid').length);

  const handleRepaid = () => void fetchLoans();
</script>

<svelte:head>
  <title>Dashboard | Vouch</title>
</svelte:head>

<div
  class="flex flex-col py-6 px-4 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 max-w-5xl mx-auto w-full"
>
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="space-y-1">
      <h1 class="text-4xl font-black tracking-tight text-foreground flex items-center gap-3">
        <LayoutDashboard class="h-8 w-8 text-primary" />
        Dashboard
      </h1>
      <p class="text-muted-foreground font-medium">Manage your active loans and track repayments.</p>
    </div>

    {#if wallet.isConnected}
      <button
        aria-label="Refresh loans"
        class="p-2 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
        disabled={loading}
        onclick={fetchLoans}
        type="button"
      >
        <RefreshCw class={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      </button>
    {/if}
  </div>

  {#if !wallet.isConnected}
    <div class="flex flex-col items-center justify-center py-20 space-y-4 text-center">
      <div class="h-16 w-16 bg-muted rounded-2xl flex items-center justify-center">
        <WalletMinimal class="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h3 class="font-bold text-lg">Connect your wallet</h3>
        <p class="text-muted-foreground text-sm mt-1">Connect a wallet to view your loans.</p>
      </div>
    </div>
  {:else}
    <!-- Stats row -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {#each [
        { label: 'Total loans', value: loans.length },
        { label: 'Active', value: activeCnt },
        { label: 'Repaid', value: repaidCnt },
        { label: 'Liquidated', value: loans.filter((l) => l.status === 'liquidated').length },
      ] as stat (stat.label)}
        <div class="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm px-4 py-3">
          <p class="text-xs text-muted-foreground">{stat.label}</p>
          <p class="text-2xl font-black mt-0.5">{loading ? '—' : stat.value}</p>
        </div>
      {/each}
    </div>

    {#if fetchError}
      <p class="text-sm text-destructive">{fetchError}</p>
    {/if}

    <Tabs.Root bind:value={filter}>
      <Tabs.List class="mb-4">
        <Tabs.Trigger value="active">
          Active
          {#if activeCnt > 0}
            <Badge class="ml-1.5 h-5 min-w-5 text-xs" variant="secondary">{activeCnt}</Badge>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="repaid">
          Repaid
          {#if repaidCnt > 0}
            <Badge class="ml-1.5 h-5 min-w-5 text-xs" variant="secondary">{repaidCnt}</Badge>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="all">All loans</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value={filter}>
        {#if loading}
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {#each [1, 2, 3] as key (key)}
              <div class="rounded-xl border border-border/40 bg-card/60 p-5 space-y-3 animate-pulse">
                <div class="h-4 bg-muted rounded w-24"></div>
                <div class="h-3 bg-muted rounded w-full"></div>
                <div class="h-3 bg-muted rounded w-3/4"></div>
                <div class="h-8 bg-muted rounded w-full mt-2"></div>
              </div>
            {/each}
          </div>
        {:else if filteredLoans.length === 0}
          <div class="flex flex-col items-center py-16 text-center space-y-3">
            <div class="h-14 w-14 bg-muted rounded-2xl flex items-center justify-center">
              <LayoutDashboard class="h-7 w-7 text-muted-foreground" />
            </div>
            <p class="font-semibold">
              {filter === 'active' ? 'No active loans' : filter === 'repaid' ? 'No repaid loans yet' : 'No loans found'}
            </p>
            <p class="text-sm text-muted-foreground max-w-xs">
              {filter === 'active'
                ? 'Head to the Borrow page to create a new loan.'
                : 'Your completed loans will appear here.'}
            </p>
          </div>
        {:else}
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {#each filteredLoans as loan (loan.id)}
              <LoanRepayCard {loan} onRepaid={handleRepaid} />
            {/each}
          </div>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</div>
