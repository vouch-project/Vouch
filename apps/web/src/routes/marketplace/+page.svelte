<script lang="ts">
  import { resolve } from '$app/paths';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import { navLinksMap } from '$lib/navLinks';
  import { supabase } from '$lib/supabase';
  import type { LoanWithTokens } from '$lib/types';
  import { cn } from '$lib/utils';
  import { Info, RefreshCw, ShieldCheck, TrendingUp, Wallet, Zap } from '@lucide/svelte';
  import type { RealtimeChannel } from '@supabase/supabase-js';
  import { ethers } from 'ethers';
  import { onDestroy } from 'svelte';

  let { data } = $props();

  let loans: LoanWithTokens[] = $state([]);
  let scores: Record<string, number> = $state({});
  let loading: boolean = $state(true);
  let refreshing: boolean = $state(false);
  let errorMsg: string | null = $state(null);
  let realtimeActive: boolean = $state(false);
  let channel: RealtimeChannel | null = $state(null);
  let activeTab: string = $state('borrow');

  const getMockLTV = (seed: string) => {
    const charSum = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return 60 + (charSum % 25);
  };

  const getRiskLevel = (score: number) => {
    if (score > 800) return { label: 'Low', color: 'bg-green-100 text-green-700 border-green-200' };
    if (score > 720) return { label: 'Medium', color: 'bg-blue-100 text-blue-700 border-blue-200' };
    return { label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-200' };
  };

  $effect(() => {
    const fetchStreamed = async () => {
      try {
        [loans, scores] = await Promise.all([data.streamed.loansPromise, data.streamed.scoresPromise]);
      } catch (err) {
        console.error(err);
        errorMsg = err instanceof Error ? err.message : 'Failed to load loans';
      } finally {
        loading = false;
      }
    };

    void fetchStreamed();
  });

  const fetchLoans = async () => {
    try {
      errorMsg = null;
      const { data: loansData, error } = await supabase
        .from('loans')
        .select(
          `
          *,
          collateralToken:tokens!loans_collateralTokenId_fkey(*),
          principalToken:tokens!loans_principalTokenId_fkey(*)
        `,
        )
        .eq('status', 'pending')
        .order('createdAt', { ascending: false });

      if (error) throw error;
      loans = loansData || [];
    } catch (e) {
      console.error('Fetch error:', e);
      errorMsg = (e instanceof Error && e.message) || 'Failed to fetch loans.';
    }
  };

  const handleRefresh = async () => {
    refreshing = true;
    await fetchLoans();
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
        .channel('public:loans')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, async () => {
          await fetchLoans();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('Realtime subscribed to loans changes.');
          }
        });
      realtimeActive = true;
    }
  };

  onDestroy(() => {
    if (channel) {
      void supabase.removeChannel(channel);
    }
  });

  const truncateAddress = (addr: string) => {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatAmount = (amount: string | null, decimals: number | null | undefined) => {
    if (amount === null || amount === '') return '0';

    try {
      // Convert to BigInt first — ethers v6's getBigInt rejects JS Numbers > MAX_SAFE_INTEGER,
      // which can happen when large uint256 strings from Postgres get coerced to Number by JSON parsing.
      const formatted = ethers.formatUnits(BigInt(amount), decimals ?? 18);
      const [whole, fraction] = formatted.split('.');

      // Use BigInt to safely format the integer part with locale commas, avoiding Number() precision loss
      const wholeFormatted = BigInt(whole).toLocaleString();

      if (!fraction) return wholeFormatted;

      // Truncate to 4 decimal places and remove trailing zeros
      const trimmedFraction = fraction.slice(0, 4).replace(/0+$/, '');

      return trimmedFraction.length > 0 ? `${wholeFormatted}.${trimmedFraction}` : wholeFormatted;
    } catch (err) {
      console.error('Format error:', err);
      return '0';
    }
  };
</script>

<svelte:head>
  <title>Marketplace | Vouch</title>
</svelte:head>

<div class="container mx-auto py-8 space-y-8 animate-in fade-in duration-700">
  <!-- Header Section -->
  <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
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

    <div class="flex items-center gap-3">
      <Button
        class="bg-background/50 backdrop-blur-sm"
        disabled={realtimeActive || refreshing}
        onclick={handleRefresh}
        size="sm"
        variant="outline"
      >
        <RefreshCw class={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
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
          <span class={cn('relative inline-flex h-2 w-2 rounded-full', realtimeActive ? 'bg-green-500' : 'bg-gray-400')}
          ></span>
        </div>
        {realtimeActive ? 'Live Updates' : 'Realtime Off'}
      </Button>
    </div>
  </div>

  {#if errorMsg}
    <div class="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-destructive flex items-center gap-3">
      <Info class="h-5 w-5" />
      <p class="font-medium">{errorMsg}</p>
    </div>
  {/if}

  <!-- Main Content Tabs -->
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
      <Card.Root class="border-border/50 shadow-xl dark:shadow-none overflow-hidden bg-card/80 backdrop-blur-md">
        <div class="overflow-x-auto">
          <Table.Root>
            <Table.Header class="bg-muted/30">
              <Table.Row>
                <Table.Head class="pl-4 sm:pl-8 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Borrower
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Score
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Amount
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Collateral
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  LTV
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  APY
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Risk
                </Table.Head>
                <Table.Head
                  class="pr-4 sm:pr-10 py-3 text-right text-[10px] sm:text-xs uppercase tracking-wider font-bold"
                >
                  Action
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if loading}
                {#each Array(5) as _, i (i)}
                  <Table.Row>
                    {#each Array(8) as _, j (j)}
                      <Table.Cell
                        class={cn('px-1 sm:px-3 lg:px-6 py-4', j === 0 && 'pl-4 sm:pl-8', j === 7 && 'pr-4 sm:pr-10')}
                      >
                        <div class="h-4 w-12 sm:w-16 sm:h-5 bg-muted animate-pulse rounded"></div>
                      </Table.Cell>
                    {/each}
                  </Table.Row>
                {/each}
              {:else if loans.length === 0}
                <Table.Row>
                  <Table.Cell class="h-64 text-center" colspan={8}>
                    <div class="flex flex-col items-center justify-center space-y-3">
                      <Zap class="h-10 w-10 text-muted-foreground/30" />
                      <p class="text-lg font-medium text-muted-foreground">No active borrow requests</p>
                      <Button href={resolve(navLinksMap.Borrow, {})} size="sm" variant="outline">Create Request</Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              {:else}
                {#each loans as loan (loan.id)}
                  {@const score = scores[loan.borrowerAddress]}
                  {@const ltv = getMockLTV(loan.borrowerAddress)}
                  {@const risk = score !== undefined ? getRiskLevel(score) : null}
                  <Table.Row class="hover:bg-muted/10 transition-colors group">
                    <Table.Cell
                      class="pl-4 sm:pl-8 py-4 font-mono text-[10px] sm:text-xs font-medium whitespace-nowrap min-w-max"
                    >
                      <div class="flex items-center gap-2 sm:gap-3">
                        <div
                          class="h-6 w-6 sm:h-8 sm:w-8 shrink-0 rounded-full bg-linear-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-[9px] sm:text-[10px]"
                        >
                          {loan.borrowerAddress.slice(2, 4).toUpperCase()}
                        </div>
                        <span class="hidden xs:inline">{truncateAddress(loan.borrowerAddress)}</span>
                        <span class="xs:hidden">{loan.borrowerAddress.slice(0, 4)}...</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                      <div class="flex items-center gap-1 sm:gap-2 font-bold text-foreground/80 text-[10px] sm:text-sm">
                        <TrendingUp class="h-3 w-3 sm:h-4 sm:w-4 text-blue-500 shrink-0" />
                        {#if score !== undefined}
                          {score}
                        {:else}
                          <div class="h-4 w-8 bg-muted animate-pulse rounded"></div>
                        {/if}
                      </div>
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                      <div class="font-bold text-foreground text-[10px] sm:text-sm">
                        {formatAmount(loan.principalAmount, loan.principalToken?.decimals)}
                        <span class="text-[9px] sm:text-xs font-semibold text-muted-foreground uppercase ml-0.5">
                          {loan.principalToken?.symbol || 'USDT'}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                      <div class="flex items-center gap-1 sm:gap-2 font-medium text-[10px] sm:text-sm">
                        {#if loan.collateralToken?.logoURI}
                          <img
                            class="h-4 w-4 sm:h-5 sm:w-5 rounded-full shrink-0"
                            alt=""
                            src={loan.collateralToken.logoURI}
                          />
                        {:else}
                          <div class="h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-muted shrink-0"></div>
                        {/if}
                        <span>
                          {formatAmount(loan.collateralAmount, loan.collateralToken?.decimals)}
                          {loan.collateralToken?.symbol || 'ETH'}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap text-[10px] sm:text-sm min-w-max"
                    >
                      <div class="flex items-center gap-1.5 sm:gap-3">
                        <div class="w-12 sm:w-16 h-1.5 sm:h-2 bg-muted rounded-full overflow-hidden hidden lg:block">
                          <div style:width="{ltv}%" class="h-full bg-green-500 transition-all"></div>
                        </div>
                        <span class="font-bold text-green-600">{ltv}%</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      class="px-1 sm:px-3 lg:px-6 py-4 font-bold text-indigo-600 text-left underline-offset-4 whitespace-nowrap text-[10px] sm:text-sm min-w-max"
                    >
                      {loan.interestRate ? `${loan.interestRate}%` : '8.5%'}
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left min-w-max">
                      {#if risk}
                        <Badge
                          class={cn('font-bold px-1 sm:px-2.5 py-0 text-[8px] sm:text-[10px]', risk.color)}
                          variant="outline"
                        >
                          {risk.label}
                        </Badge>
                      {:else}
                        <div class="h-4 w-10 bg-muted animate-pulse rounded"></div>
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="pr-4 sm:pr-10 py-4 text-right min-w-max">
                      <Button
                        class="font-bold transition-transform group-hover:scale-105 h-7 sm:h-9 py-0 px-2 sm:px-3 text-[10px] sm:text-xs"
                        size="sm"
                        variant="default"
                      >
                        Fund
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              {/if}
            </Table.Body>
          </Table.Root>
        </div>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="lend">
      <Card.Root class="border-border/50 shadow-xl dark:shadow-none overflow-hidden bg-card/80 backdrop-blur-md">
        <div class="h-64 flex flex-col items-center justify-center space-y-4 text-center p-8">
          <div class="h-16 w-16 bg-muted rounded-full flex items-center justify-center">
            <Wallet class="h-8 w-8 text-muted-foreground/50" />
          </div>
          <div>
            <h3 class="text-xl font-bold">Lend Offers Coming Soon</h3>
            <p class="text-muted-foreground max-w-sm">
              We're currently scaling our liquidity pools. Stay tuned to view and fulfill yield-bearing lend offers
              directly in the marketplace.
            </p>
          </div>
          <Button variant="secondary">Notify Me</Button>
        </div>
      </Card.Root>
    </Tabs.Content>
  </Tabs.Root>

  <!-- Ecosystem Stats Footer (Aesthetic) -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
    {#each [{ label: 'Total Value Locked', value: '$1.2M', icon: ShieldCheck, color: 'text-green-500' }, { label: 'Avg. Market APY', value: '12.4%', icon: TrendingUp, color: 'text-blue-500' }, { label: 'Loans Protected', value: '142', icon: Zap, color: 'text-amber-500' }] as stat (stat.label)}
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
