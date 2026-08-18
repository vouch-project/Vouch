<script lang="ts">
  import ClaimableFunds from '$lib/components/dashboard/ClaimableFunds.svelte';
  import CreditScoreBar from '$lib/components/dashboard/CreditScoreBar.svelte';
  import DashboardHeader from '$lib/components/dashboard/DashboardHeader.svelte';
  import DashboardStats from '$lib/components/dashboard/DashboardStats.svelte';
  import LoansTable from '$lib/components/dashboard/LoansTable.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import { formatUint256 } from '$lib/formatUint256';
  import { fetchCreditScore, type CreditScore } from '$lib/loans/creditScore';
  import { supabase } from '$lib/supabase';
  import { cancelLendOffer } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { WalletMinimal } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { DashboardData, type DashboardFilter } from './dashboard.svelte';

  // Two perspectives over the same wallet: loans the user borrowed, and loans
  // the user funded as a lender.
  const borrowedData = new DashboardData('borrower');
  const lentData = new DashboardData('lender');

  // ── Lend Offers ───────────────────────────────────────────────────────────
  type LendOfferRow = {
    id: string;
    onChainOfferId: string;
    principalAmount: string;
    minCollateralAmount: string;
    maxLtvBps: number;
    interestRateBps: number;
    duration: string;
    acceptDeadline: string;
    status: 'pending' | 'accepted' | 'cancelled' | 'expired';
    principalToken: { symbol: string; decimals: number } | null;
    collateralToken: { symbol: string; decimals: number } | null;
  };

  let myOffers = $state<LendOfferRow[]>([]);
  let offersLoading = $state(false);
  let cancellingOfferId = $state<string | null>(null);

  const fetchMyOffers = async (address: string) => {
    offersLoading = true;
    try {
      const { data, error } = await supabase
        .from('lend_offers')
        .select(
          `*,
           principalToken:tokens!lend_offers_principalTokenId_fkey(*),
           collateralToken:tokens!lend_offers_collateralTokenId_fkey(*)`,
        )
        .eq('lenderAddress', address)
        .order('createdAt', { ascending: false });
      if (error) throw error;
      myOffers = (data as LendOfferRow[]) ?? [];
    } finally {
      offersLoading = false;
    }
  };

  const handleCancelOffer = async (offer: LendOfferRow) => {
    cancellingOfferId = offer.id;
    try {
      await cancelLendOffer(BigInt(offer.onChainOfferId));
      if (wallet.address) await fetchMyOffers(wallet.address);
    } catch (e) {
      console.error('Cancel offer failed', e);
    } finally {
      cancellingOfferId = null;
    }
  };

  const statusVariant = (status: LendOfferRow['status']): 'default' | 'secondary' | 'outline' => {
    if (status === 'pending') return 'default';
    if (status === 'accepted') return 'secondary';
    return 'outline';
  };

  let perspective = $state<'borrowed' | 'lent' | 'offers'>('borrowed');
  const data = $derived(perspective === 'borrowed' ? borrowedData : lentData);
  const showLoansView = $derived(perspective === 'borrowed' || perspective === 'lent');

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
      myOffers = [];
      return;
    }
    loading = true;
    void Promise.all([fetchBoth(wallet.address), fetchMyOffers(wallet.address)]).finally(() => {
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
        <Tabs.Trigger class="font-semibold" value="offers">
          My Offers
          {#if myOffers.length > 0}
            <Badge class="ml-1.5 h-5 min-w-5 text-xs" variant="secondary">{myOffers.length}</Badge>
          {/if}
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>

    {#if showLoansView}
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
    {:else if offersLoading}
      <div class="space-y-3">
        {#each Array(2) as _, i (i)}
          <div class="h-14 rounded-lg bg-muted animate-pulse"></div>
        {/each}
      </div>
    {:else if myOffers.length === 0}
      <p class="text-center py-10 text-muted-foreground font-medium">No lend offers yet.</p>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row class="border-border/50">
            <Table.Head>Principal</Table.Head>
            <Table.Head>Collateral Req.</Table.Head>
            <Table.Head>Max LTV</Table.Head>
            <Table.Head>Rate</Table.Head>
            <Table.Head>Expires</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head class="text-right">Action</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each myOffers as offer (offer.id)}
            <Table.Row class="border-border/30 hover:bg-muted/10 transition-colors">
              <Table.Cell class="font-medium">
                {formatUint256(offer.principalAmount, offer.principalToken?.decimals ?? 18)}
                {offer.principalToken?.symbol ?? ''}
              </Table.Cell>
              <Table.Cell>{offer.collateralToken?.symbol ?? '—'}</Table.Cell>
              <Table.Cell>{(offer.maxLtvBps / 100).toFixed(2)}%</Table.Cell>
              <Table.Cell>{(offer.interestRateBps / 100).toFixed(2)}% APR</Table.Cell>
              <Table.Cell class="text-muted-foreground text-sm">
                {new Date(offer.acceptDeadline).toLocaleDateString()}
              </Table.Cell>
              <Table.Cell>
                <Badge class="capitalize" variant={statusVariant(offer.status)}>{offer.status}</Badge>
              </Table.Cell>
              <Table.Cell class="text-right">
                {#if offer.status === 'pending'}
                  <Button
                    class="font-semibold"
                    disabled={cancellingOfferId === offer.id}
                    onclick={() => handleCancelOffer(offer)}
                    size="sm"
                    variant="outline"
                  >
                    {cancellingOfferId === offer.id ? 'Cancelling…' : 'Cancel'}
                  </Button>
                {:else}
                  <span class="text-muted-foreground text-sm">—</span>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  {/if}
</div>
