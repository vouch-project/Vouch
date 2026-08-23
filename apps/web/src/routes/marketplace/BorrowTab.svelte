<script lang="ts">
  import { type SignedRequestRow } from '$api/signedOrders';
  import { resolve } from '$app/paths';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import { formatUint256 } from '$lib/formatUint256';
  import { calculateHealthFactor, formatLoanTerm, intervalToSeconds, type HealthFactorResult } from '$lib/loans/loanMath';
  import { maxLtv } from '$lib/ltv';
  import { navLinksMap } from '$lib/navLinks';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import type { LoanWithTokens } from '$lib/types';
  import { cn } from '$lib/utils';
  import { fillLoanRequest, type SignedLoanRequest } from '$lib/wallet/signedOrders';
  import { getLtvAttestation } from '$api/scoring';
  import { fundLoan } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Check, Clock, Copy, Info, RefreshCw, TrendingUp, Zap } from '@lucide/svelte';
  import { ethers } from 'ethers';
  import { deadlineSeconds, findToken, getErrorMessage, tokenAddress, truncateAddress } from './_utils';

  let { loans, scores, signedRequests, loading, errorMsg }: {
    loans: LoanWithTokens[];
    scores: Record<string, number>;
    signedRequests: SignedRequestRow[];
    loading: boolean;
    errorMsg: string | null;
  } = $props();

  let fundingLoanId: string | null = $state(null);
  let copiedAddress: string | null = $state(null);

  let fundError: string | null = $state(null);
  let signedError: string | null = $state(null);
  let fillingDigest: string | null = $state(null);

  const handleFundLoan = async (loan: LoanWithTokens) => {
    if (loan.onChainLoanId == null) return;
    if (!loan.principalAmount) return;
    fundingLoanId = loan.id;
    fundError = null;
    try {
      await fundLoan(
        ethers.getBigInt(loan.onChainLoanId),
        ethers.getBigInt(loan.principalAmount),
        loan.principalToken?.address ?? ethers.ZeroAddress,
      );
    } catch (e) {
      fundError = getErrorMessage(e);
    } finally {
      fundingLoanId = null;
    }
  };

  const toRequestStruct = (row: SignedRequestRow): SignedLoanRequest | null => {
    const collateralToken = tokenAddress(row.collateralTokenId);
    const principalToken = tokenAddress(row.principalTokenId);
    if (collateralToken === undefined || principalToken === undefined) return null;
    return {
      borrower: row.borrowerAddress,
      collateralToken,
      collateralAmount: BigInt(row.collateralAmount),
      principalToken,
      principalAmount: BigInt(row.principalAmount),
      interestRateBps: row.interestRateBps,
      durationSeconds: BigInt(intervalToSeconds(row.duration)),
      maxLtvBps: row.maxLtvBps,
      nonce: BigInt(row.nonce),
      deadline: deadlineSeconds(row.deadline),
    };
  };

  const handleFillRequest = async (row: SignedRequestRow) => {
    const req = toRequestStruct(row);
    if (!req) {
      signedError = 'Unable to reconstruct request — unknown token on this chain.';
      return;
    }
    const contractAddress = chainInfo.contractAddress;
    const networkId = wallet.networkId;
    if (!contractAddress || !networkId) {
      signedError = 'Wallet not connected to a supported network.';
      return;
    }
    fillingDigest = row.digest;
    signedError = null;
    try {
      const attestation = await getLtvAttestation(
        row.borrowerAddress,
        req.collateralToken,
        req.principalToken,
        contractAddress,
        networkId,
      );
      await fillLoanRequest(req, row.signature, attestation);
    } catch (e) {
      signedError = getErrorMessage(e);
    } finally {
      fillingDigest = null;
    }
  };

  const getRiskLevel = (hf: HealthFactorResult | null) => {
    if (!hf) return null;
    if (hf.riskStatus === 'Safe') return { label: 'Safe', color: 'bg-green-100 text-green-700 border-green-200' };
    if (hf.riskStatus === 'Warning') return { label: 'Warning', color: 'bg-amber-100 text-amber-700 border-amber-200' };
    return { label: 'High Risk', color: 'bg-red-100 text-red-700 border-red-200' };
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
          <Table.Head class="pr-4 sm:pr-10 py-3 text-right text-[10px] sm:text-xs uppercase tracking-wider font-bold">
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
        {:else if loans.length === 0 && signedRequests.length === 0}
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
            {@const colMeta = tokenPrices.getTokenMeta(loan.collateralToken?.symbol)}
            {@const prinMeta = tokenPrices.getTokenMeta(loan.principalToken?.symbol)}
            {@const collateralUsd = loan.collateralAmount ? parseFloat(ethers.formatUnits(BigInt(loan.collateralAmount), loan.collateralToken?.decimals ?? 18)) * colMeta.priceUsd : 0}
            {@const borrowUsd = loan.principalAmount ? parseFloat(ethers.formatUnits(BigInt(loan.principalAmount), loan.principalToken?.decimals ?? 18)) * prinMeta.priceUsd : 0}
            {@const currentLtv = collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0}
            {@const maxLtvVal = maxLtv(colMeta, prinMeta, score)}
            {@const ltvUtilization = maxLtvVal > 0 ? Math.min(100, (currentLtv / maxLtvVal) * 100) : 0}
            {@const hf = calculateHealthFactor(collateralUsd, borrowUsd, maxLtvVal)}
            {@const risk = getRiskLevel(hf)}
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
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-center gap-1.5 sm:gap-2">
                    <div class="w-10 sm:w-14 h-1.5 bg-muted rounded-full overflow-hidden hidden lg:block">
                      <div
                        style:width="{ltvUtilization}%"
                        class={cn('h-full transition-all', ltvUtilization < 60 ? 'bg-green-500' : ltvUtilization < 85 ? 'bg-amber-500' : 'bg-red-500')}
                      ></div>
                    </div>
                    <span class={cn('font-bold text-[10px] sm:text-sm', ltvUtilization < 60 ? 'text-green-600' : ltvUtilization < 85 ? 'text-amber-600' : 'text-red-600')}>
                      {currentLtv.toFixed(1)}%
                    </span>
                  </div>
                  <span class="text-[9px] text-muted-foreground hidden lg:block">max {maxLtvVal.toFixed(0)}%</span>
                </div>
              </Table.Cell>
              <Table.Cell
                class="px-1 sm:px-3 lg:px-6 py-4 font-bold text-indigo-600 text-left underline-offset-4 whitespace-nowrap text-[10px] sm:text-sm min-w-max"
              >
                {netApr.toFixed(2)}% APR
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                <div class="flex items-center gap-1 sm:gap-1.5 font-semibold text-foreground/80 text-[10px] sm:text-sm">
                  <Clock class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground shrink-0" />
                  {formatLoanTerm(loan.duration)}
                </div>
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left min-w-max">
                {#if risk && hf}
                  <div class="flex items-center gap-1.5">
                    <Badge class={cn('font-bold px-1 sm:px-2.5 py-0 text-[8px] sm:text-[10px]', risk.color)} variant="outline">
                      {risk.label}
                    </Badge>
                    <span class="text-[9px] text-muted-foreground hidden lg:inline">HF {hf.healthFactor.toFixed(2)}</span>
                  </div>
                {:else}
                  <div class="h-4 w-10 bg-muted animate-pulse rounded"></div>
                {/if}
              </Table.Cell>
              <Table.Cell class="pr-4 sm:pr-10 py-4 text-right min-w-max align-middle">
                {#if isOwnLoan}
                  <div class="flex items-center justify-end h-full">
                    <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">Your loan</span>
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
          {#if signedRequests.length > 0}
            {#each signedRequests as row (row.digest)}
              {@const prinTok = findToken(row.principalTokenId)}
              {@const colTok = findToken(row.collateralTokenId)}
              {@const score = scores[row.borrowerAddress]}
              {@const colMeta = tokenPrices.getTokenMeta(colTok?.symbol)}
              {@const prinMeta = tokenPrices.getTokenMeta(prinTok?.symbol)}
              {@const collateralUsd = parseFloat(ethers.formatUnits(BigInt(row.collateralAmount), colTok?.decimals ?? 18)) * colMeta.priceUsd}
              {@const borrowUsd = parseFloat(ethers.formatUnits(BigInt(row.principalAmount), prinTok?.decimals ?? 18)) * prinMeta.priceUsd}
              {@const currentLtv = collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0}
              {@const maxLtvVal = maxLtv(colMeta, prinMeta, score)}
              {@const ltvUtilization = maxLtvVal > 0 ? Math.min(100, (currentLtv / maxLtvVal) * 100) : 0}
              {@const hf = calculateHealthFactor(collateralUsd, borrowUsd, maxLtvVal)}
              {@const risk = getRiskLevel(hf)}
              {@const isOwn = wallet.address?.toLowerCase() === row.borrowerAddress.toLowerCase()}
              <Table.Row class="hover:bg-muted/10 transition-colors group">
                <Table.Cell
                  class="pl-4 sm:pl-8 py-4 font-mono text-[10px] sm:text-xs font-medium whitespace-nowrap min-w-max"
                >
                  <div class="flex items-center gap-2 sm:gap-3">
                    <div
                      class="h-6 w-6 sm:h-8 sm:w-8 shrink-0 rounded-full bg-linear-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-[9px] sm:text-[10px]"
                    >
                      {row.borrowerAddress.slice(2, 4).toUpperCase()}
                    </div>
                    <button
                      class="group/addr inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                      onclick={() => copyAddress(row.borrowerAddress)}
                      title={copiedAddress === row.borrowerAddress
                        ? 'Copied!'
                        : `${row.borrowerAddress} (click to copy)`}
                      type="button"
                    >
                      <span class="hidden xs:inline">{truncateAddress(row.borrowerAddress)}</span>
                      <span class="xs:hidden">{row.borrowerAddress.slice(0, 4)}...</span>
                      {#if copiedAddress === row.borrowerAddress}
                        <Check class="h-3 w-3 shrink-0 text-green-500" />
                      {:else}
                        <Copy
                          class="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/addr:opacity-100"
                        />
                      {/if}
                    </button>
                    <span
                      class="inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold text-amber-500 cursor-default"
                      title="EIP-712 signed off-chain order — no gas to publish. Filling it pulls the borrower's committed collateral and settles the loan on-chain in one transaction."
                    >
                      <Zap class="h-2.5 w-2.5" />Gasless
                    </span>
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
                    {formatUint256(row.principalAmount, prinTok?.decimals)}
                    <span class="text-[9px] sm:text-xs font-semibold text-muted-foreground uppercase ml-0.5">
                      {prinTok?.symbol ?? ''}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                  <div class="flex items-center gap-1 sm:gap-2 font-medium text-[10px] sm:text-sm">
                    {#if colTok?.logoURI}
                      <img class="h-4 w-4 sm:h-5 sm:w-5 rounded-full shrink-0" alt="" src={colTok.logoURI} />
                    {:else}
                      <div class="h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-muted shrink-0"></div>
                    {/if}
                    <span>{formatUint256(row.collateralAmount, colTok?.decimals)} {colTok?.symbol ?? 'ETH'}</span>
                  </div>
                </Table.Cell>
                <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                  <div class="flex items-center gap-1.5 sm:gap-2" title="max {maxLtvVal.toFixed(0)}%">
                    <div class="w-10 sm:w-14 h-1.5 bg-muted rounded-full overflow-hidden hidden lg:block">
                      <div
                        style:width="{ltvUtilization}%"
                        class={cn('h-full transition-all', ltvUtilization < 60 ? 'bg-green-500' : ltvUtilization < 85 ? 'bg-amber-500' : 'bg-red-500')}
                      ></div>
                    </div>
                    <span class={cn('font-bold text-[10px] sm:text-sm', ltvUtilization < 60 ? 'text-green-600' : ltvUtilization < 85 ? 'text-amber-600' : 'text-red-600')}>
                      {currentLtv.toFixed(1)}%
                    </span>
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
                <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left min-w-max">
                  {#if risk && hf}
                    <div class="flex flex-col gap-0.5">
                      <Badge class={cn('font-bold px-1 sm:px-2.5 py-0 text-[8px] sm:text-[10px]', risk.color)} variant="outline">
                        {risk.label}
                      </Badge>
                      <span class="text-[9px] text-muted-foreground hidden lg:block">HF {hf.healthFactor.toFixed(2)}</span>
                    </div>
                  {:else}
                    <div class="h-4 w-10 bg-muted animate-pulse rounded"></div>
                  {/if}
                </Table.Cell>
                <Table.Cell class="pr-4 sm:pr-10 py-4 text-right min-w-max align-middle">
                  {#if isOwn}
                    <div class="flex items-center justify-end h-full">
                      <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">
                        Your loan
                      </span>
                    </div>
                  {:else}
                    <Button
                      class="font-bold transition-transform group-hover:scale-105 h-7 sm:h-9 py-0 px-2 sm:px-3 text-[10px] sm:text-xs"
                      disabled={fillingDigest === row.digest || !wallet.address}
                      onclick={() => handleFillRequest(row)}
                      size="sm"
                      variant="default"
                    >
                      {#if fillingDigest === row.digest}
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
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
</Card.Root>

{#if errorMsg}
  <div
    class="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-destructive flex items-center gap-3"
  >
    <Info class="h-5 w-5" />
    <p class="font-medium">{errorMsg}</p>
  </div>
{/if}

{#if fundError}
  <div
    class="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive flex items-center gap-2"
  >
    <Info class="h-4 w-4" />
    <p class="text-sm font-medium">{fundError}</p>
  </div>
{/if}

{#if signedError}
  <div
    class="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive flex items-center gap-2"
  >
    <Info class="h-4 w-4" />
    <p class="text-sm font-medium">{signedError}</p>
  </div>
{/if}
