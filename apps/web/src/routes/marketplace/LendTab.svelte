<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import type { Token } from '$api/chain';
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
  import { getScoreAttestation } from '$api/scoring';
  import { acceptLendOffer, isNativeTokenAddress, type ScoreAttestation } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Check, Clock, Copy, Info, RefreshCw, Zap } from '@lucide/svelte';
  import { ethers } from 'ethers';
  import { COLLATERAL_BUFFER_BPS, deadlineSeconds, findToken, getErrorMessage, tokenAddress, truncateAddress, type LendOfferRow } from './_utils';

  let { lendOffers, signedOffers, loading, error }: {
    lendOffers: LendOfferRow[];
    signedOffers: SignedOfferRow[];
    loading: boolean;
    error: string | null;
  } = $props();

  let acceptingOfferId: string | null = $state(null);
  let acceptCollateralSymbol: Record<string, string> = $state({});
  let copiedAddress: string | null = $state(null);

  let attestations: Record<string, ScoreAttestation | null> = $state({});
  let attestationWallet = $state<string | undefined>(undefined);

  $effect(() => {
    if (wallet.address !== attestationWallet) {
      attestations = {};
      attestationWallet = wallet.address;
    }
  });

  let signedError: string | null = $state(null);
  let fillingDigest: string | null = $state(null);
  let gaslessOfferCollateral: Record<string, string> = $state({});

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
    const principalPriceInt = BigInt(Math.ceil(principalPriceUsd * 1e9));
    const colPriceIntNum = Math.floor(colPriceUsd * 1e9);
    if (colPriceIntNum <= 0) return null;
    const colPriceInt = BigInt(colPriceIntNum);
    const principalDec = 10n ** BigInt(offer.principalToken.decimals ?? 18);
    const colScale = 10n ** BigInt(colDecimals);
    const numer = BigInt(offer.principalAmount) * BigInt(ratioBps) * principalPriceInt * colScale;
    const denom = 10000n * colPriceInt * principalDec;
    const colAmountRaw = (numer + denom - 1n) / denom;
    const buffered = colAmountRaw + (colAmountRaw * COLLATERAL_BUFFER_BPS) / 10000n;
    return ethers.formatUnits(buffered, colDecimals);
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
    const colToken = chainInfo.tokens?.find((t) => t.symbol === symbol) ?? null;
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
    } catch (e) {
      console.error('Accept offer failed', e);
    } finally {
      acceptingOfferId = null;
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

  const requiredCollateralRaw = (offer: SignedLendOffer, principalTok: Token, colTok: Token, ratioBps?: number): bigint | null => {
    const principalPriceUsd = tokenPrices.getTokenMeta(principalTok.symbol).priceUsd;
    const colPriceUsd = tokenPrices.getTokenMeta(colTok.symbol).priceUsd;
    if (principalPriceUsd <= 0 || colPriceUsd <= 0) return null;
    const principalPriceInt = BigInt(Math.ceil(principalPriceUsd * 1e9));
    const colPriceIntNum = Math.floor(colPriceUsd * 1e9);
    if (colPriceIntNum <= 0) return null;
    const colPriceInt = BigInt(colPriceIntNum);
    const principalDec = 10n ** BigInt(principalTok.decimals ?? 18);
    const colScale = 10n ** BigInt(colTok.decimals ?? 18);
    const effectiveRatio = ratioBps ?? offer.collateralRatioBps;
    const numer = offer.principalAmount * BigInt(effectiveRatio) * principalPriceInt * colScale;
    const denom = 10000n * colPriceInt * principalDec;
    const colAmountRaw = (numer + denom - 1n) / denom;
    return colAmountRaw + (colAmountRaw * COLLATERAL_BUFFER_BPS) / 10000n;
  };

  const handleFillOffer = async (row: SignedOfferRow, chosenColTok: Token) => {
    const offer = toOfferStruct(row);
    const prinTok = findToken(row.principalTokenId);
    if (!offer || !prinTok) {
      signedError = 'Unable to reconstruct offer — unknown token on this chain.';
      return;
    }
    const contractAddress = chainInfo.contractAddress;
    const networkId = wallet.networkId;
    if (!contractAddress || !networkId) {
      signedError = 'Wallet not connected to a supported network.';
      return;
    }

    // Fetch score attestation before sizing collateral so high-score borrowers
    // benefit from trustedRatioBps. Fall back to base ratio if the endpoint is
    // unavailable — the contract accepts an empty sig and uses collateralRatioBps.
    let scoreAttestation = { score: 0, expiry: 9999999999, sig: '0x' };
    try {
      scoreAttestation = await getScoreAttestation(wallet.address!, contractAddress, networkId);
    } catch {
      // attestation service unavailable — proceed at base collateral ratio
    }

    const qualifiesForDiscount =
      offer.trustedRatioBps > 0 &&
      scoreAttestation.sig !== '0x' &&
      scoreAttestation.score >= offer.scoreThreshold &&
      scoreAttestation.expiry > Math.floor(Date.now() / 1000);
    const effectiveRatio = qualifiesForDiscount ? offer.trustedRatioBps : offer.collateralRatioBps;

    const colRaw = requiredCollateralRaw(offer, prinTok, chosenColTok, effectiveRatio);
    if (colRaw === null) {
      signedError = 'Missing price data to size the required collateral.';
      return;
    }
    const colTokenAddress = isNativeTokenAddress(chosenColTok.address) ? ethers.ZeroAddress : chosenColTok.address;
    fillingDigest = row.digest;
    signedError = null;
    try {
      await fillLendOffer(offer, colTokenAddress, colRaw, row.signature, scoreAttestation);
      signedOffers = signedOffers.filter((r) => r.digest !== row.digest);
    } catch (e) {
      signedError = getErrorMessage(e);
    } finally {
      fillingDigest = null;
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
        {:else if lendOffers.length === 0 && signedOffers.length === 0}
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
                    title={copiedAddress === offer.lenderAddress ? 'Copied!' : `${offer.lenderAddress} (click to copy)`}
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
                <span class={cn('font-bold text-foreground text-[10px] sm:text-sm', isTrusted && 'text-green-600')}>
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
                <div class="flex items-center gap-1 sm:gap-1.5 font-semibold text-foreground/80 text-[10px] sm:text-sm">
                  <Clock class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground shrink-0" />
                  {formatLoanTerm(offer.duration)}
                </div>
              </Table.Cell>
              <Table.Cell
                class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap text-[10px] sm:text-sm text-muted-foreground min-w-max"
              >
                {new Date(offer.acceptDeadline).toLocaleDateString()}
              </Table.Cell>
              <Table.Cell class="pr-4 sm:pr-6 pt-4 pb-5 text-center min-w-[180px] relative">
                {#if isOwnOffer}
                  <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">Your offer</span>
                {:else}
                  {@const colSymbol = acceptCollateralSymbol[offer.id] ?? 'ETH'}
                  {@const reqAmount = getRequiredCollateralAmount(offer, colSymbol)}
                  <div class="flex items-center justify-center gap-2">
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
          {#if signedOffers.length > 0}
            {#each signedOffers as row (row.digest)}
              {@const prinTok = findToken(row.principalTokenId)}
              {@const struct = toOfferStruct(row)}
              {@const chosenSymbol = gaslessOfferCollateral[row.digest] ?? chainInfo.tokens?.[0]?.symbol ?? 'ETH'}
              {@const chosenColTok = chainInfo.tokens?.find((t) => t.symbol === chosenSymbol) ?? null}
              {@const colRaw =
                struct && prinTok && chosenColTok ? requiredCollateralRaw(struct, prinTok, chosenColTok) : null}
              {@const isOwn = wallet.address?.toLowerCase() === row.lenderAddress.toLowerCase()}
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
                    <span
                      class="inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold text-amber-500 cursor-default"
                      title="EIP-712 signed off-chain order — no gas to publish. Filling it pulls the lender's committed principal and settles the loan on-chain in one transaction."
                    >
                      <Zap class="h-2.5 w-2.5" />Gasless
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                  <div class="font-bold text-foreground text-[10px] sm:text-sm">
                    {formatUint256(row.principalAmount, prinTok?.decimals)}
                    <span class="text-[9px] sm:text-xs font-semibold text-muted-foreground uppercase ml-0.5">
                      {prinTok?.symbol ?? ''}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                  <span class="font-bold text-foreground text-[10px] sm:text-sm">
                    {(row.collateralRatioBps / 100).toFixed(0)}%
                  </span>
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
                  {(row.interestRateBps / 100).toFixed(2)}% APR
                </Table.Cell>
                <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                  <div
                    class="flex items-center gap-1 sm:gap-1.5 font-semibold text-foreground/80 text-[10px] sm:text-sm"
                  >
                    <Clock class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground shrink-0" />
                    {formatLoanTerm(row.duration)}
                  </div>
                </Table.Cell>
                <Table.Cell
                  class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap text-[10px] sm:text-sm text-muted-foreground min-w-max"
                >
                  {new Date(row.deadline).toLocaleDateString()}
                </Table.Cell>
                <Table.Cell class="pr-4 sm:pr-6 pt-4 pb-5 text-center min-w-[180px] relative">
                  {#if isOwn}
                    <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">Your offer</span>
                  {:else}
                    <div class="flex items-center justify-center gap-2">
                      <select
                        class="rounded-md border border-border bg-background px-2 py-1 text-[10px] sm:text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                        onchange={(e) =>
                          (gaslessOfferCollateral = {
                            ...gaslessOfferCollateral,
                            [row.digest]: (e.target as HTMLSelectElement).value,
                          })}
                        value={chosenSymbol}
                      >
                        {#each chainInfo.tokens ?? [] as t (t.symbol)}
                          <option value={t.symbol}>{t.symbol}</option>
                        {/each}
                      </select>
                      <Button
                        class="font-bold h-7 py-0 px-2 sm:px-3 text-[10px] sm:text-xs"
                        disabled={fillingDigest === row.digest || !wallet.address || colRaw === null || !chosenColTok}
                        onclick={() => chosenColTok && handleFillOffer(row, chosenColTok)}
                        size="sm"
                        variant="default"
                      >
                        {#if fillingDigest === row.digest}
                          <RefreshCw class="mr-1.5 h-3 w-3 animate-spin" />
                          Accepting…
                        {:else}
                          Accept
                        {/if}
                      </Button>
                    </div>
                    {#if colRaw !== null && chosenColTok}
                      <span
                        class="absolute bottom-1 right-4 sm:right-6 text-[9px] text-muted-foreground whitespace-nowrap"
                      >
                        {parseFloat(ethers.formatUnits(colRaw, chosenColTok.decimals ?? 18)).toFixed(4)}
                        {chosenColTok.symbol}
                      </span>
                    {/if}
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          {/if}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
</Card.Root>

{#if signedError}
  <div
    class="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive flex items-center gap-2"
  >
    <Info class="h-4 w-4" />
    <p class="text-sm font-medium">{signedError}</p>
  </div>
{/if}
