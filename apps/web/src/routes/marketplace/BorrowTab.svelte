<script lang="ts">
  import { getLtvAttestation } from '$api/scoring';
  import { type SignedRequestRow } from '$api/signedOrders';
  import { resolve } from '$app/paths';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import { formatUint256 } from '$lib/formatUint256';
  import {
    calculateHealthFactor,
    formatLoanTerm,
    intervalToSeconds,
    type HealthFactorResult,
  } from '$lib/loans/loanMath';
  import { maxLtv } from '$lib/ltv';
  import { navLinksMap } from '$lib/navLinks';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import type { LoanWithTokens } from '$lib/types';
  import { cn } from '$lib/utils';
  import { fillLoanRequest, type SignedLoanRequest } from '$lib/wallet/signedOrders';
  import { fundLoan } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Check, Clock, Copy, Info, RefreshCw, TrendingUp, Zap } from '@lucide/svelte';
  import { ethers } from 'ethers';
  import { deadlineSeconds, findToken, getErrorMessage, tokenAddress, truncateAddress } from './_utils';

  let {
    loans,
    scores,
    signedRequests,
    loading,
    errorMsg,
  }: {
    loans: LoanWithTokens[];
    scores: Record<string, number>;
    signedRequests: SignedRequestRow[];
    loading: boolean;
    errorMsg: string | null;
  } = $props();

  type TokenInfo = {
    symbol: string;
    decimals?: number | null;
    logoURI?: string | null;
    address?: string | null;
  } | null;

  type BorrowRow = {
    key: string;
    borrowerAddress: string;
    principalToken: TokenInfo;
    principalAmount: string;
    collateralToken: TokenInfo;
    collateralAmount: string;
    interestRateBps: number;
    duration: string;
    isGasless: boolean;
  };

  const rows = $derived([
    ...loans.map(
      (loan): BorrowRow => ({
        key: loan.id,
        borrowerAddress: loan.borrowerAddress,
        principalToken: loan.principalToken
          ? {
              symbol: loan.principalToken.symbol,
              decimals: loan.principalToken.decimals ?? undefined,
              address: loan.principalToken.address ?? undefined,
            }
          : null,
        principalAmount: loan.principalAmount ?? '0',
        collateralToken: loan.collateralToken
          ? {
              symbol: loan.collateralToken.symbol,
              decimals: loan.collateralToken.decimals,
              logoURI: loan.collateralToken.logoURI,
            }
          : null,
        collateralAmount: loan.collateralAmount ?? '0',
        interestRateBps: Number(loan.interestRate ?? 0),
        duration: loan.duration ?? '',
        isGasless: false,
      }),
    ),
    ...signedRequests.map((row): BorrowRow => {
      const prinTok = findToken(row.principalTokenId);
      const colTok = findToken(row.collateralTokenId);
      return {
        key: row.digest,
        borrowerAddress: row.borrowerAddress,
        principalToken: prinTok ? { symbol: prinTok.symbol, decimals: prinTok.decimals } : null,
        principalAmount: row.principalAmount,
        collateralToken: colTok
          ? { symbol: colTok.symbol, decimals: colTok.decimals, logoURI: colTok.logoURI ?? undefined }
          : null,
        collateralAmount: row.collateralAmount,
        interestRateBps: row.interestRateBps,
        duration: row.duration,
        isGasless: true,
      };
    }),
  ]);

  let pendingKey: string | null = $state(null);
  let actionError: string | null = $state(null);
  let copiedAddress: string | null = $state(null);

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

  const handleFund = async (row: BorrowRow) => {
    pendingKey = row.key;
    actionError = null;
    try {
      if (row.isGasless) {
        const signedRow = signedRequests.find((r) => r.digest === row.key);
        if (!signedRow) {
          actionError = 'Request is no longer available.';
          return;
        }
        const req = toRequestStruct(signedRow);
        if (!req) {
          actionError = 'Unable to reconstruct request — unknown token on this chain.';
          return;
        }
        const contractAddress = chainInfo.contractAddress;
        const networkId = wallet.networkId;
        if (!contractAddress || !networkId) {
          actionError = 'Wallet not connected to a supported network.';
          return;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const storedAttestation =
          signedRow.ltvAttestationMaxLtvBps != null &&
          signedRow.ltvAttestationExpiry != null &&
          signedRow.ltvAttestationSig != null &&
          signedRow.ltvAttestationExpiry > nowSec
            ? {
                maxLtvBps: signedRow.ltvAttestationMaxLtvBps,
                expiry: signedRow.ltvAttestationExpiry,
                sig: signedRow.ltvAttestationSig,
              }
            : null;
        const attestation =
          storedAttestation ??
          (await getLtvAttestation(
            signedRow.borrowerAddress,
            req.collateralToken,
            req.principalToken,
            contractAddress,
            networkId,
          ));
        await fillLoanRequest(req, signedRow.signature, attestation);
        signedRequests = signedRequests.filter((r) => r.digest !== signedRow.digest);
      } else {
        const loan = loans.find((l) => l.id === row.key);
        if (!loan) return;
        if (loan.onChainLoanId == null || !loan.principalAmount) return;
        await fundLoan(
          ethers.getBigInt(loan.onChainLoanId),
          ethers.getBigInt(loan.principalAmount),
          loan.principalToken?.address ?? ethers.ZeroAddress,
        );
      }
    } catch (e) {
      actionError = getErrorMessage(e);
    } finally {
      pendingKey = null;
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
        {:else if rows.length === 0}
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
          {#each rows as row (row.key)}
            {@const score = scores[row.borrowerAddress]}
            {@const colMeta = tokenPrices.getTokenMeta(row.collateralToken?.symbol)}
            {@const prinMeta = tokenPrices.getTokenMeta(row.principalToken?.symbol)}
            {@const collateralUsd =
              parseFloat(ethers.formatUnits(BigInt(row.collateralAmount), row.collateralToken?.decimals ?? 18)) *
              colMeta.priceUsd}
            {@const borrowUsd =
              parseFloat(ethers.formatUnits(BigInt(row.principalAmount), row.principalToken?.decimals ?? 18)) *
              prinMeta.priceUsd}
            {@const currentLtv = collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0}
            {@const maxLtvVal = maxLtv(colMeta, prinMeta, score)}
            {@const ltvUtilization = maxLtvVal > 0 ? Math.min(100, (currentLtv / maxLtvVal) * 100) : 0}
            {@const hf = calculateHealthFactor(collateralUsd, borrowUsd, maxLtvVal)}
            {@const risk = getRiskLevel(hf)}
            {@const isOwn = wallet.address?.toLowerCase() === row.borrowerAddress.toLowerCase()}
            {@const grossApr = row.interestRateBps / 100}
            {@const netApr = grossApr * (1 - chainInfo.protocolFeeBps / 10000)}
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
                    title={copiedAddress === row.borrowerAddress ? 'Copied!' : `${row.borrowerAddress} (click to copy)`}
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
                  {#if row.isGasless}
                    <span
                      class="inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold text-amber-500 cursor-default"
                      title="EIP-712 signed off-chain order — no gas to publish. Filling it pulls the borrower's committed collateral and settles the loan on-chain in one transaction."
                    >
                      <Zap class="h-2.5 w-2.5" />Gasless
                    </span>
                  {/if}
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
                  {formatUint256(row.principalAmount, row.principalToken?.decimals)}
                  <span class="text-[9px] sm:text-xs font-semibold text-muted-foreground uppercase ml-0.5">
                    {row.principalToken?.symbol ?? ''}
                  </span>
                </div>
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                <div class="flex items-center gap-1 sm:gap-2 font-medium text-[10px] sm:text-sm">
                  {#if row.collateralToken?.logoURI}
                    <img class="h-4 w-4 sm:h-5 sm:w-5 rounded-full shrink-0" alt="" src={row.collateralToken.logoURI} />
                  {:else}
                    <div class="h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-muted shrink-0"></div>
                  {/if}
                  <span>
                    {formatUint256(row.collateralAmount, row.collateralToken?.decimals)}
                    {row.collateralToken?.symbol ?? 'ETH'}
                  </span>
                </div>
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-center gap-1.5 sm:gap-2">
                    <div class="w-10 sm:w-14 h-1.5 bg-muted rounded-full overflow-hidden hidden lg:block">
                      <div
                        style:width="{ltvUtilization}%"
                        class={cn(
                          'h-full transition-all',
                          ltvUtilization < 60 ? 'bg-green-500' : ltvUtilization < 85 ? 'bg-amber-500' : 'bg-red-500',
                        )}
                      ></div>
                    </div>
                    <span
                      class={cn(
                        'font-bold text-[10px] sm:text-sm',
                        ltvUtilization < 60
                          ? 'text-green-600'
                          : ltvUtilization < 85
                            ? 'text-amber-600'
                            : 'text-red-600',
                      )}
                    >
                      {currentLtv.toFixed(1)}%
                    </span>
                  </div>
                  <span class="text-[9px] text-muted-foreground hidden lg:block">max {maxLtvVal.toFixed(0)}%</span>
                </div>
              </Table.Cell>
              <Table.Cell
                class="px-1 sm:px-3 lg:px-6 py-4 font-bold text-indigo-600 text-left whitespace-nowrap text-[10px] sm:text-sm min-w-max"
              >
                {#if isOwn}
                  {grossApr.toFixed(2)}% APR
                {:else}
                  {netApr.toFixed(2)}% APR
                {/if}
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left whitespace-nowrap min-w-max">
                <div class="flex items-center gap-1 sm:gap-1.5 font-semibold text-foreground/80 text-[10px] sm:text-sm">
                  <Clock class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground shrink-0" />
                  {formatLoanTerm(row.duration)}
                </div>
              </Table.Cell>
              <Table.Cell class="px-1 sm:px-3 lg:px-6 py-4 text-left min-w-max">
                {#if risk && hf}
                  <div class="flex items-center gap-1.5">
                    <Badge
                      class={cn('font-bold px-1 sm:px-2.5 py-0 text-[8px] sm:text-[10px]', risk.color)}
                      variant="outline"
                    >
                      {risk.label}
                    </Badge>
                    <span class="text-[9px] text-muted-foreground hidden lg:inline">
                      HF {hf.healthFactor.toFixed(2)}
                    </span>
                  </div>
                {:else}
                  <div class="h-4 w-10 bg-muted animate-pulse rounded"></div>
                {/if}
              </Table.Cell>
              <Table.Cell class="pr-4 sm:pr-10 py-4 text-right min-w-max align-middle">
                {#if isOwn}
                  <div class="flex items-center justify-end h-full">
                    <span class="text-[10px] sm:text-xs font-semibold text-muted-foreground italic">Your loan</span>
                  </div>
                {:else}
                  <Button
                    class="font-bold transition-transform group-hover:scale-105 h-7 sm:h-9 py-0 px-2 sm:px-3 text-[10px] sm:text-xs"
                    disabled={pendingKey === row.key || !wallet.address}
                    onclick={() => handleFund(row)}
                    size="sm"
                    variant="default"
                  >
                    {#if pendingKey === row.key}
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

{#if errorMsg}
  <div
    class="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-destructive flex items-center gap-3"
  >
    <Info class="h-5 w-5" />
    <p class="font-medium">{errorMsg}</p>
  </div>
{/if}

{#if actionError}
  <div
    class="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive flex items-center gap-2"
  >
    <Info class="h-4 w-4" />
    <p class="text-sm font-medium">{actionError}</p>
  </div>
{/if}
