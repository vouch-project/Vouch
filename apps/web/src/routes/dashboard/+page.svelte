<script lang="ts">
  import ClaimableFunds from '$lib/components/dashboard/ClaimableFunds.svelte';
  import CreditScoreBar from '$lib/components/dashboard/CreditScoreBar.svelte';
  import DashboardHeader from '$lib/components/dashboard/DashboardHeader.svelte';
  import DashboardStats from '$lib/components/dashboard/DashboardStats.svelte';
  import LoansTable from '$lib/components/dashboard/LoansTable.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Tabs from '$lib/components/ui/tabs';
  import { fetchCreditScore, type CreditScore } from '$lib/loans/creditScore';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { WalletMinimal } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { DashboardData, type DashboardFilter } from './dashboard.svelte';

  // Two perspectives over the same wallet: loans the user borrowed, and loans
  // the user funded as a lender.
  const borrowedData = new DashboardData('borrower');
  const lentData = new DashboardData('lender');

  let perspective = $state<'borrowed' | 'lent'>('borrowed');
  const data = $derived(perspective === 'borrowed' ? borrowedData : lentData);

  let loading = $state(false);
  let refreshing = $state(false);

  // ── Credit score ──────────────────────────────────────────────────────────
  let creditScore = $state<CreditScore | null>(null);
  let scoreLoading = $state(false);

  const loadCreditScore = async () => {
    if (!wallet.address) return;
    scoreLoading = true;
    creditScore = await fetchCreditScore(wallet.address);
    scoreLoading = false;
  };

  const fetchBoth = (address: string) => Promise.all([borrowedData.fetch(address), lentData.fetch(address)]);

  const handleRefresh = async () => {
    if (!wallet.address) return;
    refreshing = true;
    await Promise.all([fetchBoth(wallet.address), loadCreditScore()]);
    refreshing = false;
  };

  // Keep the realtime indicator consistent by toggling both perspectives together.
  const handleToggleRealtime = () => {
    borrowedData.toggleRealtime();
    lentData.toggleRealtime();
  };

  onDestroy(() => {
    borrowedData.destroy();
    lentData.destroy();
  });

  $effect(() => {
    // Read wallet.address here so the effect re-runs when it changes; otherwise
    // it never refetches after the wallet connects.
    if (!wallet.address) {
      borrowedData.reset();
      lentData.reset();
      creditScore = null;
      return;
    }
    loading = true;
    void fetchBoth(wallet.address).finally(() => {
      loading = false;
    });
    void loadCreditScore();
  });

  // A repayment changes both sides of the book, so refetch both.
  const handleRepaid = () => {
    if (wallet.address) void fetchBoth(wallet.address);
  };

  // ── Filtering ─────────────────────────────────────────────────────────────
  let filter = $state<DashboardFilter>('active');
  const filteredLoans = $derived(data.filter(filter));
</script>

<svelte:head>
  <title>Dashboard | Vouch</title>
</svelte:head>

<div class="container mx-auto py-8 space-y-8 animate-in fade-in duration-700">
  <DashboardHeader
    busy={refreshing || loading}
    isConnected={wallet.isConnected}
    onRefresh={handleRefresh}
    onToggleRealtime={handleToggleRealtime}
    realtimeActive={data.realtimeActive}
  />

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
    <ClaimableFunds onClaimed={handleRepaid} />

    <Tabs.Root bind:value={perspective}>
      <Tabs.List class="mb-4">
        <Tabs.Trigger value="borrowed">
          Borrowed
          {#if borrowedData.loans.length > 0}
            <Badge class="ml-1.5 h-5 min-w-5 text-xs" variant="secondary">{borrowedData.loans.length}</Badge>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="lent">
          Lent
          {#if lentData.loans.length > 0}
            <Badge class="ml-1.5 h-5 min-w-5 text-xs" variant="secondary">{lentData.loans.length}</Badge>
          {/if}
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>

    <DashboardStats
      active={data.activeCount}
      liquidated={data.liquidatedCount}
      {loading}
      repaid={data.repaidCount}
      total={data.loans.length}
    />

    {#if perspective === 'borrowed'}
      <CreditScoreBar loading={scoreLoading} score={creditScore} />
    {/if}

    {#if data.fetchError}
      <p class="text-sm text-destructive">{data.fetchError}</p>
    {/if}

    <Tabs.Root bind:value={filter}>
      <Tabs.List class="mb-4">
        <Tabs.Trigger value="active">
          Active
          {#if data.activeCount > 0}
            <Badge class="ml-1.5 h-5 min-w-5 text-xs" variant="secondary">{data.activeCount}</Badge>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="repaid">
          Repaid
          {#if data.repaidCount > 0}
            <Badge class="ml-1.5 h-5 min-w-5 text-xs" variant="secondary">{data.repaidCount}</Badge>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="all">All loans</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value={filter}>
        <LoansTable {filter} {loading} loans={filteredLoans} onRepaid={handleRepaid} role={data.role} />
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</div>
