<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount, onDestroy } from 'svelte';
  import { ethers } from 'ethers';
  import type { RealtimeChannel } from '@supabase/supabase-js';

  // TODO: share types with backend (tRPC?)
  interface Token {
    address: string;
    chainId: number;
    decimals: number | null;
    id: string;
    logoURI: string | null;
    name: string | null;
    symbol: string;
    updatedAt: string;
  }

  interface Loan {
    id: string;
    loanId: number;
    borrower: string;
    chainId: number;
    collateralAmount: number;
    collateralTokenId: string;
    status: 'pending' | 'active' | 'repaid' | 'defaulted' | 'cancelled';
    createdAt: string;
    token_list?: Token | null;
  }

  let { data } = $props();

  let loans: Loan[] = $state([]);
  let loading: boolean = $state(true);
  let refreshing: boolean = $state(false);
  let errorMsg: string | null = $state(null);
  let realtimeActive: boolean = $state(false);
  let channel: RealtimeChannel | null = $state(null);

  $effect(() => {
    const fetchStreamed = async () => {
      try {
        loans = await data.streamed.loansPromise;
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
      const { data, error } = await supabase
        .from('loans')
        .select(`*, token_list (*)`)
        .order('createdAt', { ascending: false });

      if (error) throw error;

      loans = data || [];
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
      // Tear down
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
      realtimeActive = false;
    } else {
      // Set up
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

  onMount(() => {
    void fetchLoans();
  });

  onDestroy(() => {
    if (channel) {
      void supabase.removeChannel(channel);
    }
  });

  const truncateAddress = (addr: string) => {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatCollateral = (amount: number, decimals: number | null | undefined) => {
    try {
      return Number(ethers.formatUnits(amount.toString(), decimals || 18)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      });
    } catch {
      return '0';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'repaid':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'defaulted':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };
</script>

<svelte:head>
  <title>Marketplace - Vouch</title>
</svelte:head>

<div class="space-y-6 animate-in fade-in duration-500">
  <!-- Header row: title + controls -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-gray-900">Marketplace</h1>
      <p class="text-gray-500 text-lg">Browse and fund active loan requests.</p>
    </div>

    <div class="flex items-center gap-2">
      <!-- Refresh button -->
      <button
        class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors duration-150
          {realtimeActive
          ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'}"
        disabled={realtimeActive || refreshing}
        onclick={handleRefresh}
        title={realtimeActive ? 'Disable realtime to refresh manually' : 'Refresh loans'}
        type="button"
      >
        <svg class="w-4 h-4" class:animate-spin={refreshing} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </svg>
        Refresh
      </button>

      <!-- Realtime toggle button -->
      <button
        class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors duration-150
          {realtimeActive
          ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'}"
        onclick={toggleRealtime}
        type="button"
      >
        <!-- Live dot indicator -->
        <span class="relative flex h-2 w-2">
          {#if realtimeActive}
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          {/if}
          <span
            class="relative inline-flex rounded-full h-2 w-2"
            class:bg-gray-400={!realtimeActive}
            class:bg-green-500={realtimeActive}
          ></span>
        </span>
        {realtimeActive ? 'Live' : 'Realtime'}
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
      <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
      {errorMsg}
    </div>
  {/if}

  <!-- Table -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    {#if loading}
      <!-- Skeleton rows -->
      <table class="w-full">
        <thead>
          <tr class="border-b border-gray-100 bg-gray-50/60">
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Borrower</th>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Collateral</th>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Date</th>
            <th class="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each Array(5) as _, i (i)}
            <tr class="border-b border-gray-50 animate-pulse">
              <td class="px-5 py-3"><div class="h-4 bg-gray-200 rounded w-28"></div></td>
              <td class="px-5 py-3"><div class="h-4 bg-gray-200 rounded w-24"></div></td>
              <td class="px-5 py-3"><div class="h-5 bg-gray-200 rounded-full w-16"></div></td>
              <td class="px-5 py-3"><div class="h-4 bg-gray-200 rounded w-20"></div></td>
              <td class="px-5 py-3 text-right"><div class="h-8 bg-gray-200 rounded-lg w-20 ml-auto"></div></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if loans.length === 0}
      <div class="px-5 py-16 text-center flex flex-col items-center">
        <div class="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3 text-gray-400">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M20 12H4M8 16l-4-4 4-4" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
          </svg>
        </div>
        <h3 class="text-base font-medium text-gray-900 mb-0.5">No active loan requests</h3>
        <p class="text-sm text-gray-500">Check back later or create a request yourself.</p>
      </div>
    {:else}
      <table class="w-full">
        <thead>
          <tr class="border-b border-gray-100 bg-gray-50/60">
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Borrower</th>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Collateral</th>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Date</th>
            <th class="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each loans as loan (loan.id)}
            <tr class="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/50 transition-colors duration-100">
              <td class="px-5 py-3">
                <span class="font-mono text-sm text-gray-900" title={loan.borrower}>
                  {truncateAddress(loan.borrower)}
                </span>
              </td>
              <td class="px-5 py-3">
                <span class="text-sm text-gray-900 flex items-center gap-1.5">
                  {#if loan.token_list?.logoURI}
                    <img class="w-4 h-4 rounded-full" alt="Token" src={loan.token_list.logoURI} />
                  {/if}
                  {formatCollateral(loan.collateralAmount, loan.token_list?.decimals)}
                  <span class="text-gray-500">{loan.token_list?.symbol || 'Unknown'}</span>
                </span>
              </td>
              <td class="px-5 py-3">
                <span
                  class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize {getStatusColor(
                    loan.status,
                  )}"
                >
                  {loan.status}
                </span>
              </td>
              <td class="px-5 py-3">
                <span class="text-sm text-gray-500">
                  {new Date(loan.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </td>
              <td class="px-5 py-3 text-right">
                <button
                  class="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-colors duration-150"
                  type="button"
                >
                  View
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="px-5 py-3 border-t border-gray-100 bg-gray-50/40 text-xs text-gray-500">
        Showing {loans.length} request{loans.length !== 1 ? 's' : ''}
      </div>
    {/if}
  </div>
</div>
