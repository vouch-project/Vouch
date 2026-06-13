<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import LoanRepayRow from '$lib/components/ui/LoanRepayRow.svelte';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import { supabase } from '$lib/supabase';
  import type { LoanFull } from '$lib/types';
  import { cn } from '$lib/utils';
  import { tableColumns } from './columns';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Gauge, LayoutDashboard, RefreshCw, WalletMinimal } from '@lucide/svelte';
  import type { RealtimeChannel } from '@supabase/supabase-js';
  import type { Address } from '@vouch/database-types';
  import { ethers } from 'ethers';
  import { onDestroy } from 'svelte';

  // ── Credit score ──────────────────────────────────────────────────────────
  type CreditScore = {
    score: number;
    confidence: number;
    factors: string[];
    explanation: string | null;
  };
  let creditScore = $state<CreditScore | null>(null);
  let scoreLoading = $state(false);

  const getRiskLevel = (score: number) => {
    if (score > 800) return { label: 'Low risk', color: 'text-green-600 border-green-200 bg-green-50' };
    if (score > 720) return { label: 'Medium risk', color: 'text-blue-600 border-blue-200 bg-blue-50' };
    return { label: 'High risk', color: 'text-orange-600 border-orange-200 bg-orange-50' };
  };

  const fetchCreditScore = async () => {
    if (!wallet.address) return;
    scoreLoading = true;
    try {
      const { data } = await axiosApi.get<CreditScore>(`/scoring/${encodeURIComponent(wallet.address)}`);
      creditScore = data;
    } catch {
      creditScore = null;
    } finally {
      scoreLoading = false;
    }
  };

  // ── Data fetching ─────────────────────────────────────────────────────────
  let loans = $state<LoanFull[]>([]);
  let loading = $state(false);
  let refreshing = $state(false);
  let fetchError = $state('');
  let realtimeActive = $state(false);
  let channel: RealtimeChannel | null = $state(null);

  const fetchLoans = async () => {
    if (!wallet.address) return;
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

    if (error) {
      fetchError = error.message;
      return;
    }
    loans = (data ?? []) as unknown as LoanFull[];
  };

  const handleRefresh = async () => {
    refreshing = true;
    await Promise.all([fetchLoans(), fetchCreditScore()]);
    refreshing = false;
  };

  const toggleRealtime = () => {
    if (realtimeActive) {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
      realtimeActive = false;
    } else {
      channel = supabase
        .channel('public:dashboard-loans')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, () => {
          void fetchLoans();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
          void fetchLoans();
        })
        .subscribe();
      realtimeActive = true;
    }
  };

  onDestroy(() => {
    if (channel) {
      void supabase.removeChannel(channel);
    }
  });

  $effect(() => {
    // Read wallet.address here so the effect re-runs when it changes; otherwise
    // it never refetches after the wallet connects (the read is buried in fetchLoans).
    if (!wallet.address) {
      loans = [];
      creditScore = null;
      return;
    }
    loading = true;
    void fetchLoans().finally(() => {
      loading = false;
    });
    void fetchCreditScore();
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

<div class="container mx-auto py-8 space-y-8 animate-in fade-in duration-700">
  <!-- Header -->
  <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
    <div class="space-y-2">
      <h1
        class="text-4xl font-extrabold tracking-tight lg:text-5xl bg-linear-to-r from-gray-900 via-gray-700 to-gray-500 dark:from-white dark:via-gray-200 dark:to-gray-400 bg-clip-text text-transparent"
      >
        Dashboard
      </h1>
      <p class="text-xl text-muted-foreground font-medium">Manage your active loans and track repayments.</p>
    </div>

    {#if wallet.isConnected}
      <div class="flex items-center gap-3">
        <Button
          class="bg-background/50 backdrop-blur-sm"
          disabled={realtimeActive || refreshing || loading}
          onclick={handleRefresh}
          size="sm"
          variant="outline"
        >
          <RefreshCw class={cn('mr-2 h-4 w-4', (refreshing || loading) && 'animate-spin')} />
          Refresh
        </Button>

        <Button
          class={cn(
            'backdrop-blur-sm w-[130px]',
            realtimeActive && 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
          )}
          onclick={toggleRealtime}
          size="sm"
          variant={realtimeActive ? 'secondary' : 'outline'}
        >
          <div class="mr-2 flex h-2 w-2 items-center justify-center">
            {#if realtimeActive}
              <span class="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-green-400 opacity-75"></span>
            {/if}
            <span
              class={cn('relative inline-flex h-2 w-2 rounded-full', realtimeActive ? 'bg-green-500' : 'bg-gray-400')}
            ></span>
          </div>
          {realtimeActive ? 'Live Updates' : 'Realtime Off'}
        </Button>
      </div>
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
      {#each [{ label: 'Total loans', value: loans.length }, { label: 'Active', value: activeCnt }, { label: 'Repaid', value: repaidCnt }, { label: 'Liquidated', value: loans.filter((l) => l.status === 'liquidated').length }] as stat (stat.label)}
        <div class="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm px-4 py-3">
          <p class="text-xs text-muted-foreground">{stat.label}</p>
          <p class="text-2xl font-black mt-0.5">{loading ? '—' : stat.value}</p>
        </div>
      {/each}
    </div>

    <!-- Credit score -->
    {#if scoreLoading && !creditScore}
      <div class="h-12 w-48 bg-muted animate-pulse rounded-xl"></div>
    {:else if creditScore}
      {@const risk = getRiskLevel(creditScore.score)}
      <div class="flex items-center gap-3 text-sm">
        <Gauge class="h-5 w-5 text-primary shrink-0" />
        <span class="font-bold">Credit score</span>
        <span class="text-2xl font-black">{creditScore.score}</span>
        <Badge class={cn('font-bold text-[10px]', risk.color)} variant="outline">{risk.label}</Badge>
        {#if creditScore.explanation}
          <span class="text-muted-foreground truncate">· {creditScore.explanation}</span>
        {/if}
      </div>
    {/if}

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
        <Card.Root class="border-border/50 overflow-hidden bg-card/60 backdrop-blur-sm">
          <div class="overflow-x-auto">
            <Table.Root class="table-fixed">
              <Table.Header class="bg-muted/30">
                <Table.Row>
                  {#each tableColumns as col (col.label)}
                    <Table.Head
                      class={cn(
                        col.width,
                        'py-3 text-xs uppercase tracking-wider font-bold',
                        col.align === 'left' && 'text-left pl-4 sm:pl-6',
                        col.align === 'center' && 'text-center px-2 sm:px-4',
                        col.align === 'right' && 'text-right pr-4 sm:pr-6',
                      )}
                    >
                      {col.label}
                    </Table.Head>
                  {/each}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if loading}
                  {#each [1, 2, 3] as key (key)}
                    <Table.Row>
                      {#each Array(7) as _, j (j)}
                        <Table.Cell
                          class={cn('px-2 sm:px-4 py-4', j === 0 && 'pl-4 sm:pl-6', j === 6 && 'pr-4 sm:pr-6')}
                        >
                          <div class="h-4 w-16 bg-muted animate-pulse rounded"></div>
                        </Table.Cell>
                      {/each}
                    </Table.Row>
                  {/each}
                {:else if filteredLoans.length === 0}
                  <Table.Row>
                    <Table.Cell class="h-56 text-center" colspan={7}>
                      <div class="flex flex-col items-center justify-center space-y-3">
                        <div class="h-14 w-14 bg-muted rounded-2xl flex items-center justify-center">
                          <LayoutDashboard class="h-7 w-7 text-muted-foreground" />
                        </div>
                        <p class="font-semibold">
                          {filter === 'active'
                            ? 'No active loans'
                            : filter === 'repaid'
                              ? 'No repaid loans yet'
                              : 'No loans found'}
                        </p>
                        <p class="text-sm text-muted-foreground max-w-xs">
                          {filter === 'active'
                            ? 'Head to the Borrow page to create a new loan.'
                            : 'Your completed loans will appear here.'}
                        </p>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {:else}
                  {#each filteredLoans as loan (loan.id)}
                    <LoanRepayRow {loan} onRepaid={handleRepaid} />
                  {/each}
                {/if}
              </Table.Body>
            </Table.Root>
          </div>
        </Card.Root>
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</div>
