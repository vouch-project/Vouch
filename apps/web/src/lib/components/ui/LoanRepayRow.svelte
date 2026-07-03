<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import LoanRepayForm from '$lib/components/ui/LoanRepayForm.svelte';
  import LoanStatusBadge from '$lib/components/ui/LoanStatusBadge.svelte';
  import * as Table from '$lib/components/ui/table';
  import { formatUint256 } from '$lib/formatUint256';
  import { computeProgressPct, computeRemaining, computeTotalDue, formatDueDateLabel } from '$lib/loans/loanMath';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import type { LoanFull } from '$lib/types';
  import { cn } from '$lib/utils';
  import { cancelLoan, getHealthFactor, getRepaymentDetails, type RepaymentDetails } from '$lib/wallet/vouchVault';
  import { Check, Copy } from '@lucide/svelte';
  import { ethers } from 'ethers';
  import { tableColumns } from '../dashboard/columns';
  import HealthFactorBadge from './HealthFactorBadge.svelte';

  type Props = {
    loan: LoanFull;
    onRepaid?: () => void;
    role?: 'borrower' | 'lender';
  };

  let { loan, onRepaid, role = 'borrower' }: Props = $props();

  let copiedAddress = $state<string | null>(null);

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

  const isEthPrincipal = $derived(!loan.principalToken?.address || loan.principalToken.address === ethers.ZeroAddress);
  const principalDecimals = $derived(loan.principalToken?.decimals ?? 18);
  const principalSymbol = $derived(loan.principalToken?.symbol ?? 'ETH');

  const collateralDecimals = $derived(loan.collateralToken?.decimals ?? 18);
  const collateralSymbol = $derived(loan.collateralToken?.symbol ?? 'ETH');

  // ── DB-derived repayment progress ─────────────────────────────────────────
  // The embedded transactions relation contains every transaction for the loan
  // (collateral deposit, disbursement, …); keep only the repayment payments.
  const repaymentTxs = $derived(loan.repaymentTransactions.filter((tx) => tx.type === 'repayment'));
  const amountRepaidFromDB = $derived(repaymentTxs.reduce((sum, tx) => sum + BigInt(tx.amount ?? 0), 0n));

  // Protocol-fee rows record the actual fee skimmed from interest at each repayment
  // (borrower -> treasury). Summing them gives the real fee taken so far, which is
  // used below instead of recomputing from the current bps (the fee can change over
  // a loan's life, so applying the current rate to past repayments would misreport).
  const protocolFeeTxs = $derived(loan.repaymentTransactions.filter((tx) => tx.type === 'protocol_fee'));
  const protocolFeePaidFromDB = $derived(protocolFeeTxs.reduce((sum, tx) => sum + BigInt(tx.amount ?? 0), 0n));

  const principalRaw = $derived(BigInt(loan.principalAmount ?? '0'));
  const interestRateRaw = $derived(BigInt(loan.interestRate ?? '0'));
  const fundedAtMs = $derived(loan.fundedAt ? new Date(loan.fundedAt).getTime() : 0);
  const durationSecondsFromDB = $derived(
    loan.dueAt && loan.fundedAt
      ? BigInt(Math.max(0, Math.floor((new Date(loan.dueAt).getTime() - new Date(loan.fundedAt).getTime()) / 1000)))
      : 0n,
  );
  // `loan.interestRate` is stored as annual basis points. Pending/unfunded loans owe nothing
  // yet (chain getRepaymentDetails reports 0 until funding); compute the per-day accrued total
  // only once funded. For repaid loans, freeze the displayed total to the amount actually paid
  // (matching the contract, which reports totalDue == amountRepaid once repaid).
  const totalDueFromDB = $derived(
    loan.status === 'repaid'
      ? amountRepaidFromDB
      : loan.fundedAt
        ? computeTotalDue(principalRaw, interestRateRaw, fundedAtMs, durationSecondsFromDB)
        : 0n,
  );
  const remainingFromDB = $derived(computeRemaining(totalDueFromDB, amountRepaidFromDB));

  // ── Chain hydration (active loans only) ───────────────────────────────────
  // For active loans we also fetch exact on-chain state so the repay form has
  // the precise remaining balance. Repaid / pending loans skip this entirely.
  let chainDetails = $state<RepaymentDetails | null>(null);
  let chainError = $state('');
  let healthFactor = $state<bigint | null>(null);
  let hfLoading = $state(false);

  // Chain state is authoritative once loaded; DB status is the initial fallback
  // while the blockchain listener hasn't yet written the update.
  const isRepaid = $derived(chainDetails?.repaid ?? loan.status === 'repaid');
  const isActive = $derived(!isRepaid && loan.status === 'active');
  const isPending = $derived(!isRepaid && loan.status === 'pending');

  $effect(() => {
    // Guard on loan.status (not the chainDetails-derived `isActive`) so setting
    // chainDetails below can't feed back into this effect's dependencies.
    // Hydrate from chain for active loans (live remaining/accrued) and for repaid
    // loans (so the row shows the real amount repaid / total due even when the DB
    // repayment transactions haven't been mirrored locally).
    if (loan.onChainLoanId === null) return;
    if (loan.status !== 'active' && loan.status !== 'repaid') return;

    const onChainLoanId = BigInt(loan.onChainLoanId);
    const refresh = () =>
      getRepaymentDetails(onChainLoanId)
        .then((d) => {
          chainDetails = d;
          chainError = '';
        })
        .catch((e) => {
          chainError = (e as Error).message;
        });

    // Fetch immediately. Repaid loans are terminal, so a single fetch suffices;
    // active loans poll so accrued interest / remaining tick up live (interest
    // accrues daily; 30s keeps the figure reasonably fresh).
    void refresh();
    if (loan.status !== 'active') return;
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    if (loan.onChainLoanId === null || loan.status !== 'active') return;
    hfLoading = true;
    getHealthFactor(BigInt(loan.onChainLoanId))
      .then((hf) => {
        healthFactor = hf;
      })
      .catch(() => {
        healthFactor = null;
      })
      .finally(() => {
        hfLoading = false;
      });
  });

  // ── Due date (from DB field, fallback to chain duration) ──────────────────
  const dueDate = $derived.by(() => {
    if (loan.dueAt) return new Date(loan.dueAt);
    if (!chainDetails || chainDetails.durationSeconds === 0n || !loan.fundedAt) return null;
    return new Date(new Date(loan.fundedAt).getTime() + Number(chainDetails.durationSeconds) * 1000);
  });

  const isOverdue = $derived(!isRepaid && dueDate ? dueDate < new Date() : false);
  const dueDateLabel = $derived(formatDueDateLabel(dueDate));

  // ── Displayed values: prefer chain data if loaded, otherwise DB ───────────
  const displayRemaining = $derived(chainDetails ? chainDetails.remaining : remainingFromDB);
  const displayTotalDue = $derived(chainDetails ? chainDetails.totalDue : totalDueFromDB);
  const displayAmountRepaid = $derived(chainDetails ? chainDetails.amountRepaid : amountRepaidFromDB);
  const displayInterestRateBps = $derived(chainDetails ? chainDetails.interestRateBps : Number(interestRateRaw));
  const interestAmount = $derived(displayTotalDue > principalRaw ? displayTotalDue - principalRaw : 0n);

  // Lenders receive interest net of the protocol fee (taken from the interest portion only),
  // so the Lent tab shows the yield they actually earn rather than the gross the borrower pays.
  const isLenderView = $derived(role === 'lender');
  const lenderNetBps = $derived(Math.max(0, 10000 - chainInfo.protocolFeeBps));

  // ── Repaid breakdown (interest-first amortization) ────────────────────────
  // `principalRepaid`/`collateralReleased` are monotonic on-chain bookkeeping that
  // can't be reconstructed client-side (interest keeps accruing on the outstanding
  // balance). The listener caches them in the DB on every repayment event, so use
  // those for the initial paint and let the live chain read take over once it lands.
  const principalRepaidFromDB = $derived(BigInt(loan.principalRepaid ?? '0'));
  const collateralReleasedFromDB = $derived(loan.collateralReleased != null ? BigInt(loan.collateralReleased) : null);
  const principalRepaidSoFar = $derived(chainDetails ? chainDetails.principalRepaid : principalRepaidFromDB);
  const interestRepaidSoFar = $derived(
    displayAmountRepaid > principalRepaidSoFar ? displayAmountRepaid - principalRepaidSoFar : 0n,
  );
  // Collateral is released proportional to principal repaid; full repayment returns the remainder.
  const collateralRaw = $derived(BigInt(loan.collateralAmount ?? '0'));
  const collateralReleasedSoFar = $derived(
    chainDetails
      ? chainDetails.collateralReleased
      : collateralReleasedFromDB != null
        ? collateralReleasedFromDB
        : isRepaid
          ? collateralRaw
          : principalRaw > 0n
            ? (collateralRaw * principalRepaidSoFar) / principalRaw
            : 0n,
  );

  // Net interest for the lender: full amount over the loan vs. the part realized so far.
  // The total is a forward projection at the current fee (future fees are unknown), but the
  // earned figure uses the actual fees recorded on past repayments so it never misreports
  // realized yield when the protocol fee changes mid-loan.
  const lenderNetInterestTotal = $derived((interestAmount * BigInt(lenderNetBps)) / 10000n);
  const lenderNetInterestEarned = $derived(
    interestRepaidSoFar > protocolFeePaidFromDB ? interestRepaidSoFar - protocolFeePaidFromDB : 0n,
  );
  // Interest accrued but not yet repaid (still owed to the lender).
  const lenderNetInterestRemaining = $derived(
    lenderNetInterestTotal > lenderNetInterestEarned ? lenderNetInterestTotal - lenderNetInterestEarned : 0n,
  );

  // Interest-column figure: borrowers see gross interest accrued; lenders see the net
  // interest realized so far ("earned"), or — before any repayment — the full
  // prospective interest ("to earn"), so the number keeps pace with repayments.
  const displayInterestAmount = $derived(
    isLenderView ? (lenderNetInterestEarned > 0n ? lenderNetInterestEarned : lenderNetInterestTotal) : interestAmount,
  );
  const interestLabel = $derived(isLenderView ? (lenderNetInterestEarned > 0n ? 'earned' : 'to earn') : 'accrued');

  const displayAprPct = $derived(
    isLenderView ? (displayInterestRateBps / 100) * (lenderNetBps / 10000) : displayInterestRateBps / 100,
  );

  // ── Repaid-so-far column: net for lenders, gross for borrowers ────────────
  const lenderReceivedSoFar = $derived(principalRepaidSoFar + lenderNetInterestEarned);
  const lenderReceivable = $derived(principalRaw + lenderNetInterestTotal);
  const shownAmountRepaid = $derived(isLenderView ? lenderReceivedSoFar : displayAmountRepaid);
  const shownTotalDue = $derived(isLenderView ? lenderReceivable : displayTotalDue);
  const shownProgressPct = $derived(computeProgressPct(shownAmountRepaid, shownTotalDue, isRepaid));

  let expanded = $state(false);
  let cancelling = $state(false);
  let cancelError = $state('');

  const handlePaid = (details: RepaymentDetails) => {
    chainDetails = details;
    if (details.repaid) {
      expanded = false;
      onRepaid?.();
    }
  };

  const handleCancel = async () => {
    if (loan.onChainLoanId === null) return;
    cancelling = true;
    cancelError = '';
    try {
      await cancelLoan(BigInt(loan.onChainLoanId));
      onRepaid?.(); // reuse the row-refresh hook so the parent reloads the list
    } catch (e) {
      cancelError = (e as Error).message;
    } finally {
      cancelling = false;
    }
  };
</script>

<Table.Row class={cn('hover:bg-muted/10 transition-colors', isRepaid && 'opacity-60', isOverdue && 'bg-destructive/5')}>
  <!-- Loan # -->
  <Table.Cell class="pl-4 sm:pl-6 py-3 font-bold whitespace-nowrap">
    #{loan.onChainLoanId ?? '—'}
    <div class="text-[10px] font-normal text-muted-foreground">
      {#if loan.fundedAt}
        Funded {new Date(loan.fundedAt).toLocaleDateString()}
      {:else}
        Awaiting funding
      {/if}
    </div>
  </Table.Cell>

  <!-- Principal -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    {formatUint256(loan.principalAmount ?? '0', principalDecimals)}
    <span class="text-muted-foreground text-xs">{principalSymbol}</span>
    {#if principalRepaidSoFar > 0n}
      <div class="text-[10px] text-muted-foreground">
        {formatUint256(principalRepaidSoFar.toString(), principalDecimals)} returned
      </div>
    {/if}
  </Table.Cell>

  <!-- Collateral -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    {formatUint256(loan.collateralAmount ?? '0', collateralDecimals)}
    <span class="text-muted-foreground text-xs">{collateralSymbol}</span>
    {#if collateralReleasedSoFar > 0n}
      <div class="text-[10px] text-muted-foreground">
        {formatUint256(collateralReleasedSoFar.toString(), collateralDecimals)} released
      </div>
    {/if}
  </Table.Cell>

  <!-- Interest -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    <span
      class="font-medium"
      title={isLenderView ? `Net of ${(chainInfo.protocolFeeBps / 100).toFixed(2)}% current protocol fee` : undefined}
    >
      {displayAprPct.toFixed(2)}% APR
    </span>
    <div class="text-xs text-muted-foreground">
      +{formatUint256(displayInterestAmount.toString(), principalDecimals)}
      {interestLabel}
    </div>
    {#if isLenderView && lenderNetInterestEarned > 0n && lenderNetInterestRemaining > 0n}
      <div class="text-[10px] text-muted-foreground/80">
        +{formatUint256(lenderNetInterestRemaining.toString(), principalDecimals)} still accruing
      </div>
    {/if}
  </Table.Cell>

  <!-- Repaid so far -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    <div class="flex flex-col gap-1">
      <span title={isLenderView ? 'Net of protocol fee — what you receive (principal + net interest)' : undefined}>
        {formatUint256(shownAmountRepaid.toString(), principalDecimals)}
        /
        {formatUint256(shownTotalDue.toString(), principalDecimals)}
        <span class="text-muted-foreground text-xs">({shownProgressPct}%)</span>
      </span>
      <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          style:width="{shownProgressPct}%"
          class={cn(
            'h-full transition-all',
            shownProgressPct === 100 ? 'bg-primary' : isOverdue ? 'bg-destructive' : 'bg-primary/70',
          )}
        ></div>
      </div>
    </div>
  </Table.Cell>

  <!-- Due date -->
  <Table.Cell
    class={cn('px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm', isOverdue && 'text-destructive font-semibold')}
  >
    {#if isRepaid && loan.repaidAt}
      Repaid {new Date(loan.repaidAt).toLocaleDateString()}
    {:else}
      {dueDateLabel}
    {/if}
  </Table.Cell>

  <!-- Health Factor -->
  <Table.Cell class="px-2 sm:px-4 py-3 whitespace-nowrap text-center">
    <HealthFactorBadge {healthFactor} loading={hfLoading} />
  </Table.Cell>

  <!-- Status -->
  <Table.Cell class="px-2 sm:px-4 py-3 whitespace-nowrap text-center">
    <LoanStatusBadge {isOverdue} {isPending} {isRepaid} status={loan.status} />
  </Table.Cell>

  <!-- Action / Counterparty -->
  <Table.Cell class="pr-4 sm:pr-6 py-3 text-right whitespace-nowrap">
    {#if role === 'lender'}
      <!-- Lenders watch their funded loans; repayment/cancellation are borrower actions.
           Surface the counterparty they lent to instead. -->
      {#if loan.borrowerAddress}
        <button
          type="button"
          class="group/addr inline-flex items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          title={copiedAddress === loan.borrowerAddress ? 'Copied!' : `${loan.borrowerAddress} (click to copy)`}
          onclick={() => copyAddress(loan.borrowerAddress as string)}
        >
          {loan.borrowerAddress.slice(0, 5)}…
          {#if copiedAddress === loan.borrowerAddress}
            <Check class="h-3 w-3 shrink-0 text-green-500" />
          {:else}
            <Copy class="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/addr:opacity-100" />
          {/if}
        </button>
      {:else}
        <span class="font-mono text-xs text-muted-foreground">—</span>
      {/if}
    {:else if isActive}
      <Button
        class="font-bold h-8 px-3 text-xs"
        onclick={() => (expanded = !expanded)}
        size="sm"
        variant={isOverdue ? 'destructive' : 'default'}
      >
        {expanded ? 'Close' : 'Repay'}
      </Button>
    {:else if isPending && loan.onChainLoanId !== null}
      <Button
        class="font-bold h-8 px-3 text-xs"
        disabled={cancelling}
        onclick={handleCancel}
        size="sm"
        variant="destructive"
      >
        {cancelling ? 'Cancelling…' : 'Cancel request'}
      </Button>
      {#if cancelError}
        <p class="text-[10px] text-destructive">{cancelError}</p>
      {/if}
    {/if}
  </Table.Cell>
</Table.Row>

{#if expanded && isActive && loan.onChainLoanId !== null}
  <Table.Row class="bg-muted/20 hover:bg-muted/20">
    <Table.Cell class="px-4 sm:px-6 py-4" colspan={tableColumns.length}>
      {#if chainError}
        <p class="text-xs text-destructive">{chainError}</p>
      {:else}
        <LoanRepayForm
          {isEthPrincipal}
          {isOverdue}
          onChainLoanId={loan.onChainLoanId}
          onClose={() => (expanded = false)}
          onPaid={handlePaid}
          {principalDecimals}
          {principalSymbol}
          principalTokenAddress={loan.principalToken?.address}
          remaining={displayRemaining}
          {repaymentTxs}
        />
      {/if}
    </Table.Cell>
  </Table.Row>
{/if}
