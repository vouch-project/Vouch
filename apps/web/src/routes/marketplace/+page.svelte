<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import { resolve } from '$app/paths';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import { formatUint256 } from '$lib/formatUint256';
  import { formatLoanTerm } from '$lib/loans/loanMath';
  import { maxLtv } from '$lib/ltv';
  import { navLinksMap } from '$lib/navLinks';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import { supabase } from '$lib/supabase';
  import type { LoanWithTokens } from '$lib/types';
  import { cn } from '$lib/utils';
  import { acceptLendOffer, fundLoan, type ScoreAttestation } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Check, Clock, Copy, Info, RefreshCw, ShieldCheck, TrendingUp, Zap } from '@lucide/svelte';
  import type { RealtimeChannel } from '@supabase/supabase-js';
  import type { Address } from '@vouch/database-types';
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
  let fundingLoanId: string | null = $state(null);
  let copiedAddress: string | null = $state(null);

  // --- Lend Offers tab ---
  type LendOfferRow = {
    id: string;
    onChainOfferId: string;
    lenderAddress: string;
    principalAmount: string;
    collateralRatioBps: number;
    trustedRatioBps: number;
    scoreThreshold: number;
    maxLtvBps: number;
    interestRateBps: number;
    duration: string;
    acceptDeadline: string;
    status: string;
    principalToken: { symbol: string; decimals: number; address: string } | null;
  };

  let lendOffers: LendOfferRow[] = $state([]);
  let lendOffersLoading = $state(true);
  let lendOffersError: string | null = $state(null);
  let acceptingOfferId: string | null = $state(null);

  // Per-offer state: which collateral token the borrower wants to post
  let acceptCollateralSymbol: Record<string, string> = $state({});

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
    } finally {
      lendOffersLoading = false;
    }
  };

  const getAcceptCollateralToken = (offerId: string) => {
    const symbol = acceptCollateralSymbol[offerId] ?? 'ETH';
    return chainInfo.tokens?.find((t) => t.symbol === symbol) ?? null;
  };

  // Per-offer cached attestation, keyed by wallet+offer so switching wallets never reuses a stale sig.
  let attestations: Record<string, ScoreAttestation | null> = $state({});
  let attestationWallet = $state<string | undefined>(undefined);

  $effect(() => {
    if (wallet.address !== attestationWallet) {
      attestations = {};
      attestationWallet = wallet.address;
    }
  });

  const getEffectiveRatioBps = (offer: LendOfferRow): number => {
    const att = attestations[offer.id];
    if (
      att &&
      offer.trustedRatioBps > 0 &&
      att.score >= offer.scoreThreshold &&
      att.expiry > Math.floor(Date.now() / 1000)
    ) {
      return offer.trustedRatioBps;
    }
    return offer.collateralRatioBps;
  };

  const getRequiredCollateralAmount = (offer: LendOfferRow, symbol: string): string | null => {
    const colToken = chainInfo.tokens?.find((t) => t.symbol === symbol) ?? null;
    if (!colToken || !offer.principalToken) return null;
    const principalPriceUsd = tokenPrices.getTokenMeta(offer.principalToken.symbol).priceUsd;
    const colPriceUsd = tokenPrices.getTokenMeta(symbol).priceUsd;
    if (principalPriceUsd <= 0 || colPriceUsd <= 0) return null;
    const ratioBps = getEffectiveRatioBps(offer);
    const colDecimals = colToken.decimals ?? 18;
    // Integer arithmetic with ceiling so we never submit less than the contract requires.
    // colAmount_raw = ceil(principalAmount_raw * ratioBps * principalPrice * 10^colDecimals
    //                      / (10000 * colPrice * 10^principalDecimals))
    // Prices are scaled by 1e9 for integer representation; the factors cancel in num/denom.
    const principalPriceInt = BigInt(Math.ceil(principalPriceUsd * 1e9));
    const colPriceInt = BigInt(Math.floor(colPriceUsd * 1e9));
    const principalDec = 10n ** BigInt(offer.principalToken.decimals ?? 18);
    const colScale = 10n ** BigInt(colDecimals);
    const numer = BigInt(offer.principalAmount) * BigInt(ratioBps) * principalPriceInt * colScale;
    const denom = 10000n * colPriceInt * principalDec;
    const colAmountRaw = (numer + denom - 1n) / denom;
    return ethers.formatUnits(colAmountRaw, colDecimals);
  };

  const fetchAttestation = async (offerId: string) => {
    if (!wallet.address || !chainInfo.contractAddress || !wallet.networkId || attestations[offerId] !== undefined)
      return;
    try {
      const { data } = await axiosApi.get<ScoreAttestation>(
        `/scoring/${encodeURIComponent(wallet.address)}/attestation`,
        { params: { contractAddress: chainInfo.contractAddress, chainId: wallet.networkId } },
      );
      attestations = { ...attestations, [offerId]: data };
    } catch {
      attestations = { ...attestations, [offerId]: null };
    }
  };

  const handleAcceptOffer = async (offer: LendOfferRow) => {
    const symbol = acceptCollateralSymbol[offer.id] ?? 'ETH';
    const colToken = getAcceptCollateralToken(offer.id);
    const colAmount = getRequiredCollateralAmount(offer, symbol);
    if (!colToken || !colAmount) return;
    acceptingOfferId = offer.id;
    try {
      const att = attestations[offer.id] ?? undefined;
      await acceptLendOffer(
        BigInt(offer.onChainOfferId),
        colToken as import('$api/chain').Token,
        colAmount,
        att ?? undefined,
      );
      lendOffers = lendOffers.filter((o) => o.id !== offer.id);
    } catch (e) {
      console.error('Accept offer failed', e);
    } finally {
      acceptingOfferId = null;
    }
  };

  $effect(() => {
    void fetchLendOffers();
  });

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
        errorMsg = getErrorMessage(err);
      } finally {
        loading = false;
      }
    };

    void fetchStreamed();
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
        .or(`fundDeadline.is.null,fundDeadline.gt.${new Date().toISOString()}`)
        .order('createdAt', { ascending: false });

      if (error) throw error;
      loans = loansData || [];
      await fetchScores(loans);
    } catch (e) {
      console.error('Fetch error:', e);
      errorMsg = getErrorMessage(e);
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

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      copiedAddress = addr;
      setTimeout(() => {
        if (copiedAddress === addr) copiedAddress = null;
      }, 1500);
    } catch {
      // Ignore clipboard failures (e.g. permissions / insecure context).
    }
  };

  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) {
      const err = e as { code?: unknown; reason?: unknown };
      if (err.code === 'ACTION_REJECTED') return 'Transaction rejected.';
      if (typeof err.reason === 'string' && err.reason) return err.reason;
      // Strip verbose ethers prefix like "ethers-user-denied: ..."
      const msg = e.message.replace(/^[\w-]+:\s*/, '');
      return msg || 'An unexpected error occurred.';
    }
    return 'An unexpected error occurred.';
  };

  const handleFundLoan = async (loan: LoanWithTokens) => {
    if (loan.onChainLoanId == null) {
      errorMsg = 'Loan is missing on-chain ID.';
      return;
    }

    if (!loan.principalAmount) {
      errorMsg = 'Loan is missing principal amount.';
      return;
    }

    fundingLoanId = loan.id;
    errorMsg = null;

    try {
      await fundLoan(
        ethers.getBigInt(loan.onChainLoanId),
        ethers.getBigInt(loan.principalAmount),
        loan.principalToken?.address ?? ethers.ZeroAddress,
      );
      loans = loans.filter((l) => l.id !== loan.id);
    } catch (e) {
      errorMsg = getErrorMessage(e);
    } finally {
      fundingLoanId = null;
    }
  };
</script>

<svelte:head>
  <title>Marketplace | Vouch</title>
</svelte:head>

<div class="w-full py-8 space-y-8 animate-in fade-in duration-700">
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
          <span
            class={cn('relative inline-flex h-2 w-2 rounded-full', realtimeActive ? 'bg-green-500' : 'bg-gray-400')}
          >
          </span>
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
                  Loan Amount
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Collateral
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  LTV
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  APR
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Term
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
                    {#each Array(9) as _, j (j)}
                      <Table.Cell
                        class={cn('px-1 sm:px-3 lg:px-6 py-4', j === 0 && 'pl-4 sm:pl-8', j === 8 && 'pr-4 sm:pr-10')}
                      >
                        <div class="h-4 w-12 sm:w-16 sm:h-5 bg-muted animate-pulse rounded"></div>
                      </Table.Cell>
                    {/each}
                  </Table.Row>
                {/each}
              {:else if loans.length === 0}
                <Table.Row>
                  <Table.Cell class="h-64 text-center" colspan={9}>
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
                  {@const ltv = maxLtv(
                    tokenPrices.getTokenMeta(loan.collateralToken?.symbol),
                    tokenPrices.getTokenMeta(loan.principalToken?.symbol),
                    score,
                  )}
                  {@const risk = score !== undefined ? getRiskLevel(score) : null}
                  {@const isOwnLoan = wallet.address?.toLowerCase() === loan.borrowerAddress.toLowerCase()}
                  {@const grossApr = Number(loan.interestRate ?? 0) / 100}
                  {@const netApr = grossApr * (1 - chainInfo.protocolFeeBps / 10000)}
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
                        <button
                          class="group/addr inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                          onclick={() => copyAddress(loan.borrowerAddress)}
                          title={copiedAddress === loan.borrowerAddress
                            ? 'Copied!'
                            : `${loan.borrowerAddress} (click to copy)`}
                          type="button"
                        >
                          <span class="hidden xs:inline">{truncateAddress(loan.borrowerAddress)}</span>
                          <span class="xs:hidden">{loan.borrowerAddress.slice(0, 4)}...</span>
                          {#if copiedAddress === loan.borrowerAddress}
                            <Check class="h-3 w-3 shrink-0 text-green-500" />
                          {:else}
                            <Copy
                              class="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/addr:opacity-100"
                            />
                          {/if}
                        </button>
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
                        {formatUint256(loan.principalAmount, loan.principalToken?.decimals)}
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
                          {formatUint256(loan.collateralAmount, loan.collateralToken?.decimals)}
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
                        <span class="font-bold text-green-600">{ltv.toFixed(1)}%</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      class="px-1 sm:px-3 lg:px-6 py-4 font-bold text-indigo-600 text-left underline-offset-4 whitespace-nowrap text-[10px] sm:text-sm min-w-max"
                    >
                      {netApr.toFixed(2)}% APR
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                      <div
                        class="flex items-center gap-1 sm:gap-1.5 font-semibold text-foreground/80 text-[10px] sm:text-sm"
                      >
                        <Clock class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground shrink-0" />
                        {formatLoanTerm(loan.duration)}
                      </div>
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
                    <Table.Cell class="pr-4 sm:pr-10 py-4 text-right min-w-max align-middle">
                      {#if isOwnLoan}
                        <div class="flex items-center justify-end h-full">
                          <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">
                            Your loan
                          </span>
                        </div>
                      {:else}
                        <Button
                          class="font-bold transition-transform group-hover:scale-105 h-7 sm:h-9 py-0 px-2 sm:px-3 text-[10px] sm:text-xs"
                          disabled={fundingLoanId === loan.id}
                          onclick={() => handleFundLoan(loan)}
                          size="sm"
                          variant="default"
                        >
                          {#if fundingLoanId === loan.id}
                            <RefreshCw class="mr-1.5 h-3 w-3 animate-spin" />
                            Funding…
                          {:else}
                            Fund
                          {/if}
                        </Button>
                      {/if}
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
        <div class="overflow-x-auto">
          <Table.Root>
            <Table.Header class="bg-muted/30">
              <Table.Row>
                <Table.Head class="pl-4 sm:pl-8 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Lender
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Principal
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Col. Ratio
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Max LTV
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  APR
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Term
                </Table.Head>
                <Table.Head class="px-1 sm:px-3 lg:px-6 py-3 text-[10px] sm:text-xs uppercase tracking-wider font-bold">
                  Expires
                </Table.Head>
                <Table.Head
                  class="pr-4 sm:pr-10 py-3 text-right text-[10px] sm:text-xs uppercase tracking-wider font-bold"
                >
                  Action
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if lendOffersLoading}
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
              {:else if lendOffersError}
                <Table.Row>
                  <Table.Cell class="h-64 text-center" colspan={8}>
                    <p class="text-sm text-destructive">{lendOffersError}</p>
                  </Table.Cell>
                </Table.Row>
              {:else if lendOffers.length === 0}
                <Table.Row>
                  <Table.Cell class="h-64 text-center" colspan={8}>
                    <div class="flex flex-col items-center justify-center space-y-3">
                      <Zap class="h-10 w-10 text-muted-foreground/30" />
                      <p class="text-lg font-medium text-muted-foreground">No open lend offers right now</p>
                      <Button href={resolve(navLinksMap.Lend, {})} size="sm" variant="outline">Create Offer</Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              {:else}
                {#each lendOffers as offer (offer.id)}
                  {@const isOwnOffer = wallet.address?.toLowerCase() === offer.lenderAddress.toLowerCase()}
                  <Table.Row class="hover:bg-muted/10 transition-colors group">
                    <Table.Cell
                      class="pl-4 sm:pl-8 py-4 font-mono text-[10px] sm:text-xs font-medium whitespace-nowrap min-w-max"
                    >
                      <div class="flex items-center gap-2 sm:gap-3">
                        <div
                          class="h-6 w-6 sm:h-8 sm:w-8 shrink-0 rounded-full bg-linear-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-bold text-[9px] sm:text-[10px]"
                        >
                          {offer.lenderAddress.slice(2, 4).toUpperCase()}
                        </div>
                        <button
                          class="group/addr inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                          onclick={() => copyAddress(offer.lenderAddress)}
                          title={copiedAddress === offer.lenderAddress
                            ? 'Copied!'
                            : `${offer.lenderAddress} (click to copy)`}
                          type="button"
                        >
                          <span class="hidden xs:inline">{truncateAddress(offer.lenderAddress)}</span>
                          <span class="xs:hidden">{offer.lenderAddress.slice(0, 4)}...</span>
                          {#if copiedAddress === offer.lenderAddress}
                            <Check class="h-3 w-3 shrink-0 text-green-500" />
                          {:else}
                            <Copy
                              class="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/addr:opacity-100"
                            />
                          {/if}
                        </button>
                      </div>
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                      <div class="font-bold text-foreground text-[10px] sm:text-sm">
                        {formatUint256(offer.principalAmount, offer.principalToken?.decimals)}
                        <span class="text-[9px] sm:text-xs font-semibold text-muted-foreground uppercase ml-0.5">
                          {offer.principalToken?.symbol ?? ''}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 pt-4 pb-5 text-left whitespace-nowrap min-w-max relative">
                      {@const effectiveRatio = getEffectiveRatioBps(offer)}
                      {@const isTrusted = effectiveRatio < offer.collateralRatioBps}
                      <span
                        class={cn('font-bold text-foreground text-[10px] sm:text-sm', isTrusted && 'text-green-600')}
                      >
                        {(effectiveRatio / 100).toFixed(0)}%
                      </span>
                      {#if isTrusted}
                        <span
                          class="absolute bottom-1 left-1 sm:left-3 lg:left-6 text-[9px] text-muted-foreground line-through whitespace-nowrap"
                        >
                          {(offer.collateralRatioBps / 100).toFixed(0)}%
                        </span>
                      {:else if offer.trustedRatioBps > 0 && !isOwnOffer}
                        <button
                          class="absolute bottom-1 left-1 sm:left-3 lg:left-6 text-[9px] text-primary hover:underline text-left whitespace-nowrap"
                          onclick={() => fetchAttestation(offer.id)}
                          type="button"
                        >
                          score ≥{offer.scoreThreshold}? unlock {(offer.trustedRatioBps / 100).toFixed(0)}%
                        </button>
                      {/if}
                    </Table.Cell>
                    <Table.Cell
                      class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap text-[10px] sm:text-sm min-w-max"
                    >
                      <div class="flex items-center gap-1.5 sm:gap-3">
                        <div class="w-12 sm:w-16 h-1.5 sm:h-2 bg-muted rounded-full overflow-hidden hidden lg:block">
                          <div style:width="{offer.maxLtvBps / 100}%" class="h-full bg-green-500 transition-all"></div>
                        </div>
                        <span class="font-bold text-green-600">{(offer.maxLtvBps / 100).toFixed(1)}%</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      class="px-1 sm:px-3 lg:px-6 py-4 font-bold text-indigo-600 text-left whitespace-nowrap text-[10px] sm:text-sm min-w-max"
                    >
                      {(offer.interestRateBps / 100).toFixed(2)}% APR
                    </Table.Cell>
                    <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                      <div
                        class="flex items-center gap-1 sm:gap-1.5 font-semibold text-foreground/80 text-[10px] sm:text-sm"
                      >
                        <Clock class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground shrink-0" />
                        {formatLoanTerm(offer.duration)}
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap text-[10px] sm:text-sm text-muted-foreground min-w-max"
                    >
                      {new Date(offer.acceptDeadline).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell class="pr-4 sm:pr-6 pt-4 pb-5 text-right min-w-[180px] relative">
                      {#if isOwnOffer}
                        <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">
                          Your offer
                        </span>
                      {:else}
                        {@const colSymbol = acceptCollateralSymbol[offer.id] ?? 'ETH'}
                        {@const reqAmount = getRequiredCollateralAmount(offer, colSymbol)}
                        <div class="flex items-center justify-end gap-2">
                          <select
                            class="rounded-md border border-border bg-background px-2 py-1 text-[10px] sm:text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                            onchange={(e) =>
                              (acceptCollateralSymbol = {
                                ...acceptCollateralSymbol,
                                [offer.id]: (e.target as HTMLSelectElement).value,
                              })}
                            value={colSymbol}
                          >
                            {#each chainInfo.tokens ?? [] as t (t.symbol)}
                              <option value={t.symbol}>{t.symbol}</option>
                            {/each}
                          </select>
                          <Button
                            class="font-bold h-7 py-0 px-2 sm:px-3 text-[10px] sm:text-xs"
                            disabled={acceptingOfferId === offer.id || !wallet.address || !reqAmount}
                            onclick={() => handleAcceptOffer(offer)}
                            size="sm"
                            variant="default"
                          >
                            {#if acceptingOfferId === offer.id}
                              <RefreshCw class="mr-1.5 h-3 w-3 animate-spin" />
                              Accepting…
                            {:else}
                              Accept
                            {/if}
                          </Button>
                        </div>
                        {#if reqAmount}
                          <span
                            class="absolute bottom-1 right-4 sm:right-6 text-[9px] text-muted-foreground whitespace-nowrap"
                          >
                            {parseFloat(reqAmount).toFixed(4)}
                            {colSymbol}
                          </span>
                        {/if}
                      {/if}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              {/if}
            </Table.Body>
          </Table.Root>
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
