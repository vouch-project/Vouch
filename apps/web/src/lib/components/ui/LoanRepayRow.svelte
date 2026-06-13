<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Table from '$lib/components/ui/table';
  import { formatUint256 } from '$lib/formatUint256';
  import type { LoanFull } from '$lib/types';
  import { cn } from '$lib/utils';
  import { getRepaymentDetails, repayLoan, repayLoanWithERC20, type RepaymentDetails } from '$lib/wallet/vouchVault';
  import { AlertCircle, CheckCircle2, Clock, ExternalLink } from '@lucide/svelte';
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
  // loans.interestRate is a uint256 (string) scaled so that 1e18 == one
  // percentage point — matching the marketplace's formatUint256(rate) + "%".
  // So 5% is stored as 5e18. Keep all math in bigint to avoid precision loss.
  const PERCENT_WAD = 10n ** 18n;
  const interestRateRaw = $derived(BigInt(loan.interestRate ?? '0'));
  const totalDueFromDB = $derived(principalRaw + (principalRaw * interestRateRaw) / (100n * PERCENT_WAD));
  const remainingFromDB = $derived(totalDueFromDB > amountRepaidFromDB ? totalDueFromDB - amountRepaidFromDB : 0n);

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

  const progressPctFromDB = $derived(
    totalDueFromDB > 0n ? Number((amountRepaidFromDB * 100n) / totalDueFromDB) : isRepaid ? 100 : 0,
  );

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

  const dueDateLabel = $derived.by(() => {
    if (!dueDate) return 'No deadline';
    const diff = dueDate.getTime() - Date.now();
    // Check the sign before rounding: Math.ceil() of a small negative diff is 0,
    // which would mislabel a <1d overdue loan as "Due today".
    if (diff < 0) return `Overdue by ${Math.ceil(Math.abs(diff) / 86400000)}d`;
    const days = Math.ceil(diff / 86400000);
    if (days === 0) return 'Due today';
    return `Due in ${days}d`;
  });

  // ── Displayed values: prefer chain data if loaded, otherwise DB ───────────
  const displayProgressPct = $derived(
    chainDetails ? Number((chainDetails.amountRepaid * 100n) / (chainDetails.totalDue || 1n)) : progressPctFromDB,
  );
  const displayRemaining = $derived(chainDetails ? chainDetails.remaining : remainingFromDB);
  const displayTotalDue = $derived(chainDetails ? chainDetails.totalDue : totalDueFromDB);
  const displayAmountRepaid = $derived(chainDetails ? chainDetails.amountRepaid : amountRepaidFromDB);
  const displayInterestRateBps = $derived(
    chainDetails ? chainDetails.interestRateBps : Number((interestRateRaw * 100n) / PERCENT_WAD),
  );
  const interestAmount = $derived(displayTotalDue - principalRaw);

  // ── Payment form ──────────────────────────────────────────────────────────
  let paymentInput = $state('');
  let txStatus = $state<'idle' | 'approving' | 'confirming' | 'success' | 'error'>('idle');
  let txError = $state('');
  let expanded = $state(false);

  const paymentRaw = $derived.by(() => {
    if (!paymentInput.trim()) return 0n;
    try {
      return ethers.parseUnits(paymentInput, principalDecimals);
    } catch {
      return 0n;
    }
  });

  const paymentExceedsRemaining = $derived(paymentRaw > displayRemaining);

  const setFullPayment = () => {
    paymentInput = ethers.formatUnits(displayRemaining, principalDecimals);
  };

  const handleRepay = async () => {
    if (paymentRaw === 0n || paymentExceedsRemaining || loan.onChainLoanId === null) return;

    txStatus = 'confirming';
    txError = '';

    try {
      if (isEthPrincipal) {
        await repayLoan(BigInt(loan.onChainLoanId), paymentRaw);
      } else {
        txStatus = 'approving';
        await repayLoanWithERC20(BigInt(loan.onChainLoanId), paymentRaw, loan.principalToken!.address);
      }

      txStatus = 'success';
      paymentInput = '';

      // Refresh chain state after payment
      const updated = await getRepaymentDetails(BigInt(loan.onChainLoanId));
      chainDetails = updated;
      if (updated.repaid) {
        expanded = false;
        onRepaid?.();
      }
    } catch (e: unknown) {
      txStatus = 'error';
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'ACTION_REJECTED') {
        txError = 'Transaction rejected.';
      } else {
        txError = e instanceof Error ? e.message : 'Transaction failed.';
      }
    }
  };

  const txStatusLabel = $derived(
    txStatus === 'approving' ? 'Approving token…' : txStatus === 'confirming' ? 'Confirm in wallet…' : '',
  );

  // Latest repayment tx for the history link
  const latestTx = $derived(
    [...repaymentTxs].sort((a, b) => new Date(b.txTimestamp).getTime() - new Date(a.txTimestamp).getTime())[0] ?? null,
  );
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
    {#if isRepaid}
      <Badge class="text-primary border-primary/40 text-xs gap-1" variant="outline">
        <CheckCircle2 class="h-3 w-3" /> Repaid
      </Badge>
    {:else if isOverdue}
      <Badge class="text-xs gap-1" variant="destructive">
        <AlertCircle class="h-3 w-3" /> Overdue
      </Badge>
    {:else if isPending}
      <Badge class="text-xs gap-1" variant="secondary">
        <Clock class="h-3 w-3" /> Pending
      </Badge>
    {:else}
      <Badge class="text-xs gap-1" variant="secondary">
        <Clock class="h-3 w-3" /> Active
      </Badge>
    {/if}
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

{#if expanded && isActive}
  <Table.Row class="bg-muted/20 hover:bg-muted/20">
    <Table.Cell class="px-4 sm:px-6 py-4" colspan={7}>
      {#if chainError}
        <p class="text-xs text-destructive">{chainError}</p>
      {:else}
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
          <!-- Amount due -->
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">Amount due</p>
            <p class={cn('text-lg font-black', isOverdue && 'text-destructive')}>
              {formatUint256(displayRemaining.toString(), principalDecimals, principalDecimals)}
              <span class="text-sm font-semibold">{principalSymbol}</span>
            </p>
            {#if repaymentTxs.length > 0}
              <div class="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <span>{repaymentTxs.length} payment{repaymentTxs.length > 1 ? 's' : ''} recorded</span>
                {#if latestTx}
                  <a
                    class="flex items-center gap-1 hover:text-foreground transition-colors"
                    href="https://etherscan.io/tx/{latestTx.txHash}"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Latest tx <ExternalLink class="h-3 w-3" />
                  </a>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Payment form -->
          <div class="flex flex-col gap-2 sm:min-w-[320px]">
            <div class="flex items-center gap-2">
              <input
                class="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                inputmode="decimal"
                placeholder="Amount to repay"
                type="text"
                bind:value={paymentInput}
              />
              <button
                class="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary whitespace-nowrap transition-colors hover:bg-primary/20 hover:border-primary/60"
                onclick={setFullPayment}
                type="button"
              >
                Pay full
              </button>
            </div>

            {#if paymentExceedsRemaining}
              <p class="text-xs text-destructive">Exceeds remaining balance.</p>
            {/if}
            {#if txStatus === 'error'}
              <p class="text-xs text-destructive">{txError}</p>
            {:else if txStatus === 'success'}
              <p class="text-xs text-primary">Payment confirmed!</p>
            {:else if txStatusLabel}
              <p class="text-xs text-muted-foreground">{txStatusLabel}</p>
            {/if}

            <div class="flex gap-2 justify-center">
              <Button
                class="font-bold"
                disabled={paymentRaw === 0n ||
                  paymentExceedsRemaining ||
                  txStatus === 'confirming' ||
                  txStatus === 'approving'}
                onclick={handleRepay}
                size="sm"
              >
                {txStatus === 'approving'
                  ? 'Approving…'
                  : txStatus === 'confirming'
                    ? 'Confirming…'
                    : 'Confirm Repayment'}
              </Button>
              <Button
                class="font-medium text-muted-foreground hover:text-foreground"
                disabled={txStatus === 'confirming' || txStatus === 'approving'}
                onclick={() => {
                  expanded = false;
                  txStatus = 'idle';
                  txError = '';
                }}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      {/if}
    </Table.Cell>
  </Table.Row>
{/if}
