<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import type { Token } from '$api/chain';
  import { getScoreAttestation } from '$api/scoring';
  import { type SignedOfferRow } from '$api/signedOrders';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import { formatUint256 } from '$lib/formatUint256';
  import { formatLoanTerm, intervalToSeconds } from '$lib/loans/loanMath';
  import { navLinksMap } from '$lib/navLinks';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import { cn } from '$lib/utils';
  import { fillLendOffer, type SignedLendOffer } from '$lib/wallet/signedOrders';
  import { acceptLendOffer, isNativeTokenAddress, type ScoreAttestation } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Check, Clock, Copy, Info, RefreshCw, Zap } from '@lucide/svelte';
  import { ethers } from 'ethers';
  import {
    COLLATERAL_BUFFER_BPS,
    deadlineSeconds,
    findToken,
    getErrorMessage,
    tokenAddress,
    truncateAddress,
    type LendOfferRow,
  } from './_utils';

  let {
    lendOffers,
    signedOffers,
    loading,
    error,
  }: {
    lendOffers: LendOfferRow[];
    signedOffers: SignedOfferRow[];
    loading: boolean;
    error: string | null;
  } = $props();

  type OfferRow = {
    key: string;
    lenderAddress: string;
    principalToken: { symbol: string; decimals?: number; address?: string } | null;
    principalAmount: string;
    collateralRatioBps: number;
    trustedRatioBps: number;
    scoreThreshold: number;
    maxLtvBps: number;
    interestRateBps: number;
    duration: string;
    deadline: Date;
    isGasless: boolean;
  };

  const rows = $derived([
    ...lendOffers.map(
      (offer): OfferRow => ({
        key: offer.id,
        lenderAddress: offer.lenderAddress,
        principalToken: offer.principalToken
          ? {
              symbol: offer.principalToken.symbol,
              decimals: offer.principalToken.decimals,
              address: offer.principalToken.address,
            }
          : null,
        principalAmount: offer.principalAmount,
        collateralRatioBps: offer.collateralRatioBps,
        trustedRatioBps: offer.trustedRatioBps,
        scoreThreshold: offer.scoreThreshold,
        maxLtvBps: offer.maxLtvBps,
        interestRateBps: offer.interestRateBps,
        duration: offer.duration,
        deadline: new Date(offer.acceptDeadline),
        isGasless: false,
      }),
    ),
    ...signedOffers.map((row): OfferRow => {
      const prinTok = findToken(row.principalTokenId);
      return {
        key: row.digest,
        lenderAddress: row.lenderAddress,
        principalToken: prinTok
          ? { symbol: prinTok.symbol, decimals: prinTok.decimals, address: prinTok.address }
          : null,
        principalAmount: row.principalAmount,
        collateralRatioBps: row.collateralRatioBps,
        trustedRatioBps: row.trustedRatioBps,
        scoreThreshold: row.scoreThreshold,
        maxLtvBps: row.maxLtvBps,
        interestRateBps: row.interestRateBps,
        duration: row.duration,
        deadline: new Date(row.deadline),
        isGasless: true,
      };
    }),
  ]);

  let pendingKey: string | null = $state(null);
  let actionError: string | null = $state(null);
  let collateralSymbol: Record<string, string> = $state({});
  let copiedAddress: string | null = $state(null);

  let attestations: Record<string, ScoreAttestation | null> = $state({});
  let attestationWallet = $state<string | undefined>(undefined);

  $effect(() => {
    if (wallet.address !== attestationWallet) {
      attestations = {};
      attestationWallet = wallet.address;
    }
  });

  const getEffectiveRatioBps = (row: OfferRow): number => {
    const att = attestations[row.key];
    if (
      att &&
      row.trustedRatioBps > 0 &&
      att.score >= row.scoreThreshold &&
      att.expiry > Math.floor(Date.now() / 1000)
    ) {
      return row.trustedRatioBps;
    }
    return row.collateralRatioBps;
  };

  const getRequiredCollateralRaw = (row: OfferRow, colSymbol: string, overrideRatioBps?: number): bigint | null => {
    const colToken = chainInfo.tokens?.find((t) => t.symbol === colSymbol) ?? null;
    if (!colToken || !row.principalToken) return null;
    const principalPriceUsd = tokenPrices.getTokenMeta(row.principalToken.symbol).priceUsd;
    const colPriceUsd = tokenPrices.getTokenMeta(colSymbol).priceUsd;
    if (principalPriceUsd <= 0 || colPriceUsd <= 0) return null;
    const ratioBps = overrideRatioBps ?? getEffectiveRatioBps(row);
    const colDecimals = colToken.decimals ?? 18;
    const principalPriceInt = BigInt(Math.ceil(principalPriceUsd * 1e9));
    const colPriceIntNum = Math.floor(colPriceUsd * 1e9);
    if (colPriceIntNum <= 0) return null;
    const colPriceInt = BigInt(colPriceIntNum);
    const principalDec = 10n ** BigInt(row.principalToken.decimals ?? 18);
    const colScale = 10n ** BigInt(colDecimals);
    const numer = BigInt(row.principalAmount) * BigInt(ratioBps) * principalPriceInt * colScale;
    const denom = 10000n * colPriceInt * principalDec;
    const colAmountRaw = (numer + denom - 1n) / denom;
    return colAmountRaw + (colAmountRaw * COLLATERAL_BUFFER_BPS) / 10000n;
  };

  const getRequiredCollateralFormatted = (row: OfferRow, colSymbol: string): string | null => {
    const colToken = chainInfo.tokens?.find((t) => t.symbol === colSymbol) ?? null;
    const raw = getRequiredCollateralRaw(row, colSymbol);
    if (raw === null || !colToken) return null;
    return ethers.formatUnits(raw, colToken.decimals ?? 18);
  };

  const fetchAttestation = async (key: string) => {
    if (!wallet.address || !chainInfo.contractAddress || !wallet.networkId || attestations[key] !== undefined) return;
    try {
      const { data } = await axiosApi.get<ScoreAttestation>(
        `/scoring/${encodeURIComponent(wallet.address)}/attestation`,
        { params: { contractAddress: chainInfo.contractAddress, chainId: wallet.networkId } },
      );
      attestations = { ...attestations, [key]: data };
    } catch {
      attestations = { ...attestations, [key]: null };
    }
  };

  const toOfferStruct = (row: SignedOfferRow): SignedLendOffer | null => {
    const principalToken = tokenAddress(row.principalTokenId);
    if (principalToken === undefined) return null;
    return {
      lender: row.lenderAddress,
      principalToken,
      principalAmount: BigInt(row.principalAmount),
      collateralRatioBps: row.collateralRatioBps,
      trustedRatioBps: row.trustedRatioBps,
      scoreThreshold: row.scoreThreshold,
      maxLtvBps: row.maxLtvBps,
      interestRateBps: row.interestRateBps,
      durationSeconds: BigInt(intervalToSeconds(row.duration)),
      nonce: BigInt(row.nonce),
      deadline: deadlineSeconds(row.deadline),
    };
  };

  const handleAccept = async (row: OfferRow, colSymbol: string) => {
    const colToken = chainInfo.tokens?.find((t) => t.symbol === colSymbol) ?? null;
    if (!colToken) return;
    pendingKey = row.key;
    actionError = null;
    try {
      if (row.isGasless) {
        const signedRow = signedOffers.find((r) => r.digest === row.key);
        if (!signedRow) {
          actionError = 'Offer is no longer available.';
          return;
        }
        const offer = toOfferStruct(signedRow);
        if (!offer || !row.principalToken) {
          actionError = 'Unable to reconstruct offer — unknown token on this chain.';
          return;
        }
        const contractAddress = chainInfo.contractAddress;
        const networkId = wallet.networkId;
        const walletAddress = wallet.address;
        if (!contractAddress || !networkId || !walletAddress) {
          actionError = 'Wallet not connected to a supported network.';
          return;
        }
        let scoreAttestation = { score: 0, expiry: 9999999999, sig: '0x' };
        try {
          scoreAttestation = await getScoreAttestation(walletAddress, contractAddress, networkId);
        } catch {
          // attestation service unavailable — proceed at base collateral ratio
        }
        const qualifiesForDiscount =
          offer.trustedRatioBps > 0 &&
          scoreAttestation.sig !== '0x' &&
          scoreAttestation.score >= offer.scoreThreshold &&
          scoreAttestation.expiry > Math.floor(Date.now() / 1000);
        const effectiveRatio = qualifiesForDiscount ? offer.trustedRatioBps : offer.collateralRatioBps;
        const colRaw = getRequiredCollateralRaw(row, colSymbol, effectiveRatio);
        if (colRaw === null) {
          actionError = 'Missing price data to size the required collateral.';
          return;
        }
        const colTokenAddress = isNativeTokenAddress(colToken.address) ? ethers.ZeroAddress : colToken.address;
        await fillLendOffer(offer, colTokenAddress, colRaw, signedRow.signature, scoreAttestation);
        signedOffers = signedOffers.filter((r) => r.digest !== signedRow.digest);
      } else {
        const onChainOffer = lendOffers.find((o) => o.id === row.key);
        if (!onChainOffer) return;
        const colAmount = getRequiredCollateralFormatted(row, colSymbol);
        if (!colAmount) return;
        const att = attestations[row.key] ?? undefined;
        await acceptLendOffer(BigInt(onChainOffer.onChainOfferId), colToken as Token, colAmount, att ?? undefined);
      }
    } catch (e) {
      actionError = getErrorMessage(e);
    } finally {
      pendingKey = null;
    }
  };

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      copiedAddress = addr;
      setTimeout(() => {
        if (copiedAddress === addr) copiedAddress = null;
      }, 1500);
    } catch {
      // Ignore clipboard failures.
    }
  };
</script>

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
          <Table.Head class="pr-4 sm:pr-10 py-3 text-center text-[10px] sm:text-xs uppercase tracking-wider font-bold">
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
        {:else if error}
          <Table.Row>
            <Table.Cell class="h-64 text-center" colspan={8}>
              <p class="text-sm text-destructive">{error}</p>
            </Table.Cell>
          </Table.Row>
        {:else if rows.length === 0}
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
          {#each rows as row (row.key)}
            {@const isOwn = wallet.address?.toLowerCase() === row.lenderAddress.toLowerCase()}
            {@const grossApr = row.interestRateBps / 100}
            {@const netApr = grossApr * (1 - chainInfo.protocolFeeBps / 10000)}
            {@const colSymbol = collateralSymbol[row.key] ?? chainInfo.tokens?.[0]?.symbol ?? 'ETH'}
            {@const reqAmount = getRequiredCollateralFormatted(row, colSymbol)}
            <Table.Row class="hover:bg-muted/10 transition-colors group">
              <Table.Cell
                class="pl-4 sm:pl-8 py-4 font-mono text-[10px] sm:text-xs font-medium whitespace-nowrap min-w-max"
              >
                <div class="flex items-center gap-2 sm:gap-3">
                  <div
                    class="h-6 w-6 sm:h-8 sm:w-8 shrink-0 rounded-full bg-linear-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-bold text-[9px] sm:text-[10px]"
                  >
                    {row.lenderAddress.slice(2, 4).toUpperCase()}
                  </div>
                  <button
                    class="group/addr inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                    onclick={() => copyAddress(row.lenderAddress)}
                    title={copiedAddress === row.lenderAddress ? 'Copied!' : `${row.lenderAddress} (click to copy)`}
                    type="button"
                  >
                    <span class="hidden xs:inline">{truncateAddress(row.lenderAddress)}</span>
                    <span class="xs:hidden">{row.lenderAddress.slice(0, 4)}...</span>
                    {#if copiedAddress === row.lenderAddress}
                      <Check class="h-3 w-3 shrink-0 text-green-500" />
                    {:else}
                      <Copy
                        class="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/addr:opacity-100"
                      />
                    {/if}
                  </button>
                  {#if row.isGasless}
                    <span
                      class="inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold text-amber-500 cursor-default"
                      title="EIP-712 signed off-chain order — no gas to publish. Filling it pulls the lender's committed principal and settles the loan on-chain in one transaction."
                    >
                      <Zap class="h-2.5 w-2.5" />Gasless
                    </span>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                <div class="font-bold text-foreground text-[10px] sm:text-sm">
                  {formatUint256(row.principalAmount, row.principalToken?.decimals)}
                  <span class="text-[9px] sm:text-xs font-semibold text-muted-foreground uppercase ml-0.5">
                    {row.principalToken?.symbol ?? ''}
                  </span>
                </div>
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 pt-4 pb-5 text-left whitespace-nowrap min-w-max relative">
                {@const effectiveRatio = getEffectiveRatioBps(row)}
                {@const isTrusted = effectiveRatio < row.collateralRatioBps}
                <span class={cn('font-bold text-foreground text-[10px] sm:text-sm', isTrusted && 'text-green-600')}>
                  {(effectiveRatio / 100).toFixed(0)}%
                </span>
                {#if isTrusted}
                  <span
                    class="absolute bottom-1 left-1 sm:left-3 lg:left-6 text-[9px] text-muted-foreground line-through whitespace-nowrap"
                  >
                    {(row.collateralRatioBps / 100).toFixed(0)}%
                  </span>
                {:else if row.trustedRatioBps > 0 && !isOwn && !row.isGasless}
                  <button
                    class="absolute bottom-1 left-1 sm:left-3 lg:left-6 text-[9px] text-primary hover:underline text-left whitespace-nowrap"
                    onclick={() => fetchAttestation(row.key)}
                    type="button"
                  >
                    score ≥{row.scoreThreshold}? unlock {(row.trustedRatioBps / 100).toFixed(0)}%
                  </button>
                {/if}
              </Table.Cell>
              <Table.Cell
                class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap text-[10px] sm:text-sm min-w-max"
              >
                <div class="flex items-center gap-1.5 sm:gap-3">
                  <div class="w-12 sm:w-16 h-1.5 sm:h-2 bg-muted rounded-full overflow-hidden hidden lg:block">
                    <div style:width="{row.maxLtvBps / 100}%" class="h-full bg-green-500 transition-all"></div>
                  </div>
                  <span class="font-bold text-green-600">{(row.maxLtvBps / 100).toFixed(1)}%</span>
                </div>
              </Table.Cell>
              <Table.Cell
                class="px-1 sm:px-3 lg:px-6 py-4 font-bold text-indigo-600 text-left whitespace-nowrap text-[10px] sm:text-sm min-w-max"
              >
                {#if isOwn}
                  {netApr.toFixed(2)}% APR
                {:else}
                  {grossApr.toFixed(2)}% APR
                {/if}
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                <div class="flex items-center gap-1 sm:gap-1.5 font-semibold text-foreground/80 text-[10px] sm:text-sm">
                  <Clock class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground shrink-0" />
                  {formatLoanTerm(row.duration)}
                </div>
              </Table.Cell>
              <Table.Cell
                class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap text-[10px] sm:text-sm text-muted-foreground min-w-max"
              >
                {row.deadline.toLocaleDateString()}
              </Table.Cell>
              <Table.Cell class="pr-4 sm:pr-6 pt-4 pb-5 text-center min-w-[180px] relative">
                {#if isOwn}
                  <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">Your offer</span>
                {:else}
                  <div class="flex items-center justify-center gap-2">
                    <select
                      class="rounded-md border border-border bg-background px-2 py-1 text-[10px] sm:text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                      onchange={(e) =>
                        (collateralSymbol = {
                          ...collateralSymbol,
                          [row.key]: (e.target as HTMLSelectElement).value,
                        })}
                      value={colSymbol}
                    >
                      {#each chainInfo.tokens ?? [] as t (t.symbol)}
                        <option value={t.symbol}>{t.symbol}</option>
                      {/each}
                    </select>
                    <Button
                      class="font-bold h-7 py-0 px-2 sm:px-3 text-[10px] sm:text-xs"
                      disabled={pendingKey === row.key || !wallet.address || !reqAmount}
                      onclick={() => handleAccept(row, colSymbol)}
                      size="sm"
                      variant="default"
                    >
                      {#if pendingKey === row.key}
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

{#if actionError}
  <div
    class="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive flex items-center gap-2"
  >
    <Info class="h-4 w-4" />
    <p class="text-sm font-medium">{actionError}</p>
  </div>
{/if}
