<script lang="ts">
  import ClaimableFunds from '$lib/components/dashboard/ClaimableFunds.svelte';
  import CreditScoreBar from '$lib/components/dashboard/CreditScoreBar.svelte';
  import DashboardHeader from '$lib/components/dashboard/DashboardHeader.svelte';
  import DashboardStats from '$lib/components/dashboard/DashboardStats.svelte';
  import LoansTable from '$lib/components/dashboard/LoansTable.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import { formatUint256 } from '$lib/formatUint256';
  import { fetchCreditScore, type CreditScore } from '$lib/loans/creditScore';
  import { supabase } from '$lib/supabase';
  import { cancelLendOffer } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { WalletMinimal, Zap } from '@lucide/svelte';
  import { ethers } from 'ethers';
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
    collateralRatioBps: number;
    trustedRatioBps: number;
    scoreThreshold: number;
    maxLtvBps: number;
    interestRateBps: number;
    duration: string;
    acceptDeadline: string;
    status: 'pending' | 'accepted' | 'cancelled' | 'expired';
    principalToken: { symbol: string; decimals: number } | null;
  };

  let myOffers = $state<LendOfferRow[]>([]);
  let offersLoading = $state(false);
  let cancellingOfferId = $state<string | null>(null);

  const fetchMyOffers = async (address: string) => {
    offersLoading = true;
    try {
      const checksumAddress = ethers.getAddress(address);
      const { data, error } = await supabase
        .from('lend_offers')
        .select(
          `*,
           principalToken:tokens!lend_offers_principalTokenId_fkey(*)`,
        )
        .eq('lenderAddress', checksumAddress)
        .order('createdAt', { ascending: false });
      if (error) throw error;
      myOffers = (data as unknown as LendOfferRow[]) ?? [];
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
    {:else}
      <Card.Root class="border-border/50 overflow-hidden bg-card/60 backdrop-blur-sm">
        <div class="overflow-x-auto">
          <Table.Root class="table-fixed">
            <Table.Header class="bg-muted/30">
              <Table.Row>
                <Table.Head class="w-[8%] pl-4 sm:pl-6 py-3 text-xs uppercase tracking-wider font-bold text-left">
                  Principal
                </Table.Head>
                <Table.Head class="w-[14%] px-2 sm:px-4 py-3 text-xs uppercase tracking-wider font-bold text-center">
                  Col. Ratio
                </Table.Head>
                <Table.Head class="w-[12%] px-2 sm:px-4 py-3 text-xs uppercase tracking-wider font-bold text-center">
                  Max LTV
                </Table.Head>
                <Table.Head class="w-[14%] px-2 sm:px-4 py-3 text-xs uppercase tracking-wider font-bold text-center">
                  APR
                </Table.Head>
                <Table.Head class="w-[14%] px-2 sm:px-4 py-3 text-xs uppercase tracking-wider font-bold text-center">
                  Expires
                </Table.Head>
                <Table.Head class="w-[14%] px-2 sm:px-4 py-3 text-xs uppercase tracking-wider font-bold text-center">
                  Status
                </Table.Head>
                <Table.Head class="w-[14%] px-2 sm:px-4 py-3 text-xs uppercase tracking-wider font-bold text-center">
                  Action
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if offersLoading}
                {#each [1, 2, 3] as key (key)}
                  <Table.Row>
                    {#each Array(7) as _, j (j)}
                      <Table.Cell class="px-2 sm:px-4 py-4 text-center">
                        <div class="h-4 w-16 bg-muted animate-pulse rounded mx-auto"></div>
                      </Table.Cell>
                    {/each}
                  </Table.Row>
                {/each}
              {:else if myOffers.length === 0}
                <Table.Row>
                  <Table.Cell class="h-56 text-center" colspan={7}>
                    <div class="flex flex-col items-center justify-center space-y-3">
                      <div class="h-14 w-14 bg-muted rounded-2xl flex items-center justify-center">
                        <Zap class="h-7 w-7 text-muted-foreground" />
                      </div>
                      <p class="font-semibold">No lend offers yet</p>
                      <p class="text-sm text-muted-foreground max-w-xs">
                        Create an offer from the Lend page to start lending.
                      </p>
                    </div>
                  </Table.Cell>
                </Table.Row>
              {:else}
                {#each myOffers as offer (offer.id)}
                  <Table.Row class="hover:bg-muted/10 transition-colors">
                    <Table.Cell class="pl-4 sm:pl-6 py-4 font-medium text-sm text-left">
                      {formatUint256(offer.principalAmount, offer.principalToken?.decimals ?? 18)}
                      <span class="text-muted-foreground text-xs ml-1">{offer.principalToken?.symbol ?? ''}</span>
                    </Table.Cell>
                    <Table.Cell class="px-2 sm:px-4 py-4 text-sm text-center">
                      {(offer.collateralRatioBps / 100).toFixed(0)}%
                    </Table.Cell>
                    <Table.Cell class="px-2 sm:px-4 py-4 text-sm text-center">
                      {(offer.maxLtvBps / 100).toFixed(2)}%
                    </Table.Cell>
                    <Table.Cell class="px-2 sm:px-4 py-4 text-sm text-center">
                      {(offer.interestRateBps / 100).toFixed(2)}% APR
                    </Table.Cell>
                    <Table.Cell class="px-2 sm:px-4 py-4 text-sm text-muted-foreground text-center">
                      {new Date(offer.acceptDeadline).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell class="px-2 sm:px-4 py-4 text-center">
                      <Badge class="capitalize" variant={statusVariant(offer.status)}>{offer.status}</Badge>
                    </Table.Cell>
                    <Table.Cell class="px-2 sm:px-4 py-4 text-center">
                      <div class="flex justify-center">
                        {#if offer.status === 'pending'}
                          <Button
                            class="font-semibold h-7 sm:h-9 py-0 px-2 sm:px-3 text-xs sm:text-sm"
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
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              {/if}
            </Table.Body>
          </Table.Root>
        </div>
      </Card.Root>
    {/if}
  {/if}
</div>
