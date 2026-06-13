<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import LoanRepayForm from '$lib/components/ui/LoanRepayForm.svelte';
  import LoanStatusBadge from '$lib/components/ui/LoanStatusBadge.svelte';
  import * as Table from '$lib/components/ui/table';
  import { formatUint256 } from '$lib/formatUint256';
  import {
    computeProgressPct,
    computeRemaining,
    computeTotalDue,
    formatDueDateLabel,
    interestRateToBps,
  } from '$lib/loans/loanMath';
  import type { LoanFull } from '$lib/types';
  import { cn } from '$lib/utils';
  import { getRepaymentDetails, type RepaymentDetails } from '$lib/wallet/vouchVault';
  import { ethers } from 'ethers';

  type Props = {
    loan: LoanFull;
    onRepaid?: () => void;
  };

  let { loan, onRepaid }: Props = $props();

  const isEthPrincipal = $derived(!loan.principalToken?.address || loan.principalToken.address === ethers.ZeroAddress);
  const principalDecimals = $derived(loan.principalToken?.decimals ?? 18);
  const principalSymbol = $derived(loan.principalToken?.symbol ?? 'ETH');

  // ── DB-derived repayment progress ─────────────────────────────────────────
  // The embedded transactions relation contains every transaction for the loan
  // (collateral deposit, disbursement, …); keep only the repayment payments.
  const repaymentTxs = $derived(loan.repaymentTransactions.filter((tx) => tx.type === 'repayment'));
  const amountRepaidFromDB = $derived(repaymentTxs.reduce((sum, tx) => sum + BigInt(tx.amount ?? 0), 0n));

  const principalRaw = $derived(BigInt(loan.principalAmount ?? '0'));
  const interestRateRaw = $derived(BigInt(loan.interestRate ?? '0'));
  const totalDueFromDB = $derived(computeTotalDue(principalRaw, interestRateRaw));
  const remainingFromDB = $derived(computeRemaining(totalDueFromDB, amountRepaidFromDB));

  // ── Chain hydration (active loans only) ───────────────────────────────────
  // For active loans we also fetch exact on-chain state so the repay form has
  // the precise remaining balance. Repaid / pending loans skip this entirely.
  let chainDetails = $state<RepaymentDetails | null>(null);
  let chainError = $state('');

  // Chain state is authoritative once loaded; DB status is the initial fallback
  // while the blockchain listener hasn't yet written the update.
  const isRepaid = $derived(chainDetails?.repaid ?? loan.status === 'repaid');
  const isActive = $derived(!isRepaid && loan.status === 'active');
  const isPending = $derived(!isRepaid && loan.status === 'pending');

  const progressPctFromDB = $derived(computeProgressPct(amountRepaidFromDB, totalDueFromDB, isRepaid));

  $effect(() => {
    if (!isActive || loan.onChainLoanId === null) return;
    getRepaymentDetails(BigInt(loan.onChainLoanId))
      .then((d) => {
        chainDetails = d;
        chainError = '';
      })
      .catch((e) => {
        chainError = (e as Error).message;
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
  const displayProgressPct = $derived(
    chainDetails ? Number((chainDetails.amountRepaid * 100n) / (chainDetails.totalDue || 1n)) : progressPctFromDB,
  );
  const displayRemaining = $derived(chainDetails ? chainDetails.remaining : remainingFromDB);
  const displayTotalDue = $derived(chainDetails ? chainDetails.totalDue : totalDueFromDB);
  const displayAmountRepaid = $derived(chainDetails ? chainDetails.amountRepaid : amountRepaidFromDB);
  const displayInterestRateBps = $derived(
    chainDetails ? chainDetails.interestRateBps : interestRateToBps(interestRateRaw),
  );
  const interestAmount = $derived(displayTotalDue - principalRaw);

  let expanded = $state(false);

  const handlePaid = (details: RepaymentDetails) => {
    chainDetails = details;
    if (details.repaid) {
      expanded = false;
      onRepaid?.();
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
  </Table.Cell>

  <!-- Interest -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    {formatUint256(interestAmount.toString(), principalDecimals)}
    <span class="text-muted-foreground text-xs">
      ({(displayInterestRateBps / 100).toFixed(2)}%)
    </span>
  </Table.Cell>

  <!-- Repaid so far -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    <div class="flex flex-col gap-1">
      <span>
        {formatUint256(displayAmountRepaid.toString(), principalDecimals)}
        /
        {formatUint256(displayTotalDue.toString(), principalDecimals)}
        <span class="text-muted-foreground text-xs">({displayProgressPct}%)</span>
      </span>
      <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          style:width="{displayProgressPct}%"
          class={cn(
            'h-full transition-all',
            displayProgressPct === 100 ? 'bg-primary' : isOverdue ? 'bg-destructive' : 'bg-primary/70',
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

  <!-- Status -->
  <Table.Cell class="px-2 sm:px-4 py-3 whitespace-nowrap text-center">
    <LoanStatusBadge {isOverdue} {isPending} {isRepaid} />
  </Table.Cell>

  <!-- Action -->
  <Table.Cell class="pr-4 sm:pr-6 py-3 text-right whitespace-nowrap">
    {#if isActive}
      <Button
        class="font-bold h-8 px-3 text-xs"
        onclick={() => (expanded = !expanded)}
        size="sm"
        variant={isOverdue ? 'destructive' : 'default'}
      >
        {expanded ? 'Close' : 'Repay'}
      </Button>
    {/if}
  </Table.Cell>
</Table.Row>

{#if expanded && isActive && loan.onChainLoanId !== null}
  <Table.Row class="bg-muted/20 hover:bg-muted/20">
    <Table.Cell class="px-4 sm:px-6 py-4" colspan={7}>
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
