<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import { getSignedOffers, getSignedRequests, type SignedOfferRow, type SignedRequestRow } from '$api/signedOrders';
  import { Button } from '$lib/components/ui/button';
  import * as Tabs from '$lib/components/ui/tabs';
  import { supabase } from '$lib/supabase';
  import type { LoanWithTokens } from '$lib/types';
  import { cn } from '$lib/utils';
  import { RefreshCw, ShieldCheck } from '@lucide/svelte';
  import type { RealtimeChannel } from '@supabase/supabase-js';
  import type { Address } from '@vouch/database-types';
  import { onDestroy } from 'svelte';
  import BorrowTab from './BorrowTab.svelte';
  import LendTab from './LendTab.svelte';
  import { getErrorMessage, type LendOfferRow } from './_utils';

  let { data } = $props();

  let loans: LoanWithTokens[] = $state([]);
  let scores: Record<string, number> = $state({});
  let loansLoading = $state(true);
  let loansError: string | null = $state(null);

  let lendOffers: LendOfferRow[] = $state([]);
  let lendOffersLoading = $state(true);
  let lendOffersError: string | null = $state(null);

  let signedRequests: SignedRequestRow[] = $state([]);
  let signedOffers: SignedOfferRow[] = $state([]);

  let refreshing = $state(false);
  let realtimeActive = $state(false);
  let channel: RealtimeChannel | null = $state(null);
  let activeTab: string = $state('borrow');

  // Resolve initial streamed data
  $effect(() => {
    void (async () => {
      try {
        [loans, scores] = await Promise.all([data.streamed.loansPromise, data.streamed.scoresPromise]);
      } catch (err) {
        loansError = getErrorMessage(err);
      } finally {
        loansLoading = false;
      }
    })();
  });

  $effect(() => {
    void (async () => {
      try {
        lendOffers = await data.streamed.lendOffersPromise;
      } catch (err) {
        lendOffersError = getErrorMessage(err);
      } finally {
        lendOffersLoading = false;
      }
    })();
  });

  $effect(() => {
    void data.streamed.signedRequestsPromise.then((rows) => { signedRequests = rows; });
  });

  $effect(() => {
    void data.streamed.signedOffersPromise.then((rows) => { signedOffers = rows; });
  });

  // Fetch scores for signed-request borrowers not covered by the loans score fetch.
  $effect(() => {
    const missing = [...new Set(signedRequests.map((r) => r.borrowerAddress))].filter(
      (addr) => scores[addr] === undefined,
    );
    if (missing.length === 0) return;
    void Promise.allSettled(
      missing.map((addr) =>
        axiosApi
          .get<{ score: number }>(`/scoring/${encodeURIComponent(addr)}`)
          .then(({ data: d }) => ({ addr, score: d.score })),
      ),
    ).then((results) => {
      const extra = Object.fromEntries(
        results
          .filter((r): r is PromiseFulfilledResult<{ addr: string; score: number }> => r.status === 'fulfilled')
          .map((r) => [r.value.addr, r.value.score]),
      );
      scores = { ...scores, ...extra };
    });
  });

  const fetchScores = async (newLoans: LoanWithTokens[]) => {
    const addresses = [...new Set(newLoans.map((l) => l.borrowerAddress))];
    const results = await Promise.allSettled(
      addresses.map((address) =>
        axiosApi
          .get<{ score: number }>(`/scoring/${encodeURIComponent(address)}`)
          .then(({ data }) => ({ address, score: data.score })),
      ),
    );
    scores = Object.fromEntries(
      results
        .filter((r): r is PromiseFulfilledResult<{ address: Address; score: number }> => r.status === 'fulfilled')
        .map((r) => [r.value.address, r.value.score]),
    );
  };

  const fetchLoans = async () => {
    try {
      loansError = null;
      const { data: loansData, error } = await supabase
        .from('loans')
        .select(
          `*, collateralToken:tokens!loans_collateralTokenId_fkey(*), principalToken:tokens!loans_principalTokenId_fkey(*)`,
        )
        .eq('status', 'pending')
        .or(`fundDeadline.is.null,fundDeadline.gt.${new Date().toISOString()}`)
        .order('createdAt', { ascending: false });
      if (error) throw error;
      loans = loansData || [];
      await fetchScores(loans);
    } catch (e) {
      loansError = getErrorMessage(e);
    }
  };

  const fetchLendOffers = async () => {
    try {
      lendOffersError = null;
      const { data, error } = await supabase
        .from('lend_offers')
        .select(`*, principalToken:tokens!lend_offers_principalTokenId_fkey(*)`)
        .eq('status', 'pending')
        .gt('acceptDeadline', new Date().toISOString())
        .order('createdAt', { ascending: false });
      if (error) throw error;
      lendOffers = (data as unknown as LendOfferRow[]) ?? [];
    } catch (e) {
      lendOffersError = e instanceof Error ? e.message : 'Failed to load offers';
    }
  };

  const fetchSignedRequests = async () => {
    try {
      signedRequests = await getSignedRequests();
    } catch {
      // non-fatal: signed requests are additive to the main loan list
    }
  };

  const fetchSignedOffers = async () => {
    try {
      signedOffers = await getSignedOffers();
    } catch {
      // non-fatal
    }
  };

  const handleRefresh = async () => {
    refreshing = true;
    await Promise.all([fetchLoans(), fetchLendOffers(), fetchSignedRequests(), fetchSignedOffers()]);
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
        .channel('public:marketplace')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, () => void fetchLoans())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lend_offers' }, () => void fetchLendOffers())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signed_loan_requests' }, () => void fetchSignedRequests())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signed_lend_offers' }, () => void fetchSignedOffers())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') console.log('Realtime subscribed to marketplace changes.');
        });
      realtimeActive = true;
    }
  };

  onDestroy(() => {
    if (channel) void supabase.removeChannel(channel);
  });
</script>

<svelte:head>
  <title>Marketplace | Vouch</title>
</svelte:head>

<div class="w-full py-8 space-y-8 animate-in fade-in duration-700">
  <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
    <div class="space-y-2">
      <h1
        class="text-4xl font-extrabold tracking-tight lg:text-5xl bg-linear-to-r from-gray-900 via-gray-700 to-gray-500 dark:from-white dark:via-gray-200 dark:to-gray-400 bg-clip-text text-transparent"
      >
        Marketplace
      </h1>
      <p class="text-xl text-muted-foreground font-medium">Secure peer-to-peer lending with collateralized protection.</p>
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
      <BorrowTab {loans} {scores} {signedRequests} loading={loansLoading} errorMsg={loansError} />
    </Tabs.Content>

    <Tabs.Content value="lend">
      <LendTab {lendOffers} {signedOffers} loading={lendOffersLoading} error={lendOffersError} />
    </Tabs.Content>
  </Tabs.Root>
</div>
