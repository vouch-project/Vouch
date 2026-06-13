<script lang="ts">
  import { ethers } from 'ethers';
  import { AlertCircle, CheckCircle2, Clock, Coins, ExternalLink, Hourglass, TrendingUp } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import { formatUint256 } from '$lib/formatUint256';
  import { repayLoan, repayLoanWithERC20, getRepaymentDetails, type RepaymentDetails } from '$lib/wallet/vouchVault';
  import type { LoanFull } from '$lib/types';

  type Props = {
    loan: LoanFull;
    onRepaid?: () => void;
  };

  let { loan, onRepaid }: Props = $props();

  const isEthPrincipal = $derived(
    !loan.principalToken?.address || loan.principalToken.address === ethers.ZeroAddress,
  );
  const principalDecimals = $derived(loan.principalToken?.decimals ?? 18);
  const principalSymbol = $derived(loan.principalToken?.symbol ?? 'ETH');

  // ── DB-derived repayment progress ─────────────────────────────────────────
  // The embedded transactions relation contains every transaction for the loan
  // (collateral deposit, disbursement, …); keep only the repayment payments.
  const repaymentTxs = $derived(loan.repaymentTransactions.filter((tx) => tx.type === 'repayment'));
  const amountRepaidFromDB = $derived(
    repaymentTxs.reduce((sum, tx) => sum + BigInt(tx.amount ?? 0), 0n),
  );

  const principalRaw = $derived(BigInt(loan.principalAmount ?? '0'));
  // loans.interestRate is a uint256 (string) scaled so that 1e18 == one
  // percentage point — matching the marketplace's formatUint256(rate) + "%".
  // So 5% is stored as 5e18. Keep all math in bigint to avoid precision loss.
  const PERCENT_WAD = 10n ** 18n;
  const interestRateRaw = $derived(BigInt(loan.interestRate ?? '0'));
  const totalDueFromDB = $derived(
    principalRaw + (principalRaw * interestRateRaw) / (100n * PERCENT_WAD),
  );
  const remainingFromDB = $derived(
    totalDueFromDB > amountRepaidFromDB ? totalDueFromDB - amountRepaidFromDB : 0n,
  );

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
      .then((d) => { chainDetails = d; })
      .catch((e) => { chainError = (e as Error).message; });
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
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return `Overdue by ${Math.abs(days)}d`;
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
  let showPaymentInput = $state(false);

  const paymentRaw = $derived.by(() => {
    if (!paymentInput.trim()) return 0n;
    try { return ethers.parseUnits(paymentInput, principalDecimals); }
    catch { return 0n; }
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
      showPaymentInput = false;

      // Refresh chain state after payment
      const updated = await getRepaymentDetails(BigInt(loan.onChainLoanId));
      chainDetails = updated;
      if (updated.repaid) onRepaid?.();
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
    txStatus === 'approving' ? 'Approving token…' :
    txStatus === 'confirming' ? 'Confirm in wallet…' : '',
  );

  // Latest repayment tx for the history link
  const latestTx = $derived(
    [...repaymentTxs].sort(
      (a, b) => new Date(b.txTimestamp).getTime() - new Date(a.txTimestamp).getTime(),
    )[0] ?? null,
  );
</script>

<Card.Root
  class={cn(
    'bg-card/60 backdrop-blur-sm border-border/50 overflow-hidden transition-all duration-300',
    isOverdue && 'border-destructive/40',
    isRepaid && 'opacity-70',
  )}
>
  <!-- Progress accent bar -->
  <div class="h-1 w-full bg-muted">
    <div
      class={cn(
        'h-full transition-all duration-500',
        displayProgressPct === 100 ? 'bg-primary' : isOverdue ? 'bg-destructive' : 'bg-primary/70',
      )}
      style:width="{displayProgressPct}%"
    ></div>
  </div>

  <Card.Header class="pb-3">
    <div class="flex items-start justify-between gap-2">
      <div>
        <Card.Title class="text-base font-bold">
          Loan #{loan.onChainLoanId ?? '—'}
        </Card.Title>
        <Card.Description class="text-xs mt-0.5">
          {#if loan.fundedAt}
            Funded {new Date(loan.fundedAt).toLocaleDateString()}
          {:else}
            Awaiting funding
          {/if}
        </Card.Description>
      </div>

      <div class="flex flex-wrap gap-1 justify-end">
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
      </div>
    </div>
  </Card.Header>

  <Card.Content class="space-y-4">
    <!-- Stats grid — always shown from DB data immediately -->
    <div class="grid grid-cols-2 gap-3 text-sm">
      <div class="space-y-0.5">
        <p class="text-xs text-muted-foreground flex items-center gap-1">
          <Coins class="h-3 w-3" /> Principal
        </p>
        <p class="font-semibold">
          {formatUint256(loan.principalAmount ?? '0', principalDecimals)}
          {principalSymbol}
        </p>
      </div>

      <div class="space-y-0.5">
        <p class="text-xs text-muted-foreground flex items-center gap-1">
          <TrendingUp class="h-3 w-3" /> Interest
        </p>
        <p class="font-semibold">
          {formatUint256(interestAmount.toString(), principalDecimals)}
          {principalSymbol}
          <span class="text-muted-foreground text-xs font-normal">
            ({(displayInterestRateBps / 100).toFixed(2)}%)
          </span>
        </p>
      </div>

      <div class="space-y-0.5">
        <p class="text-xs text-muted-foreground flex items-center gap-1">
          <Hourglass class="h-3 w-3" /> Due date
        </p>
        <p class={cn('font-semibold text-sm', isOverdue && 'text-destructive')}>
          {#if isRepaid && loan.repaidAt}
            Repaid {new Date(loan.repaidAt).toLocaleDateString()}
          {:else}
            {dueDateLabel}
          {/if}
        </p>
      </div>

      <div class="space-y-0.5">
        <p class="text-xs text-muted-foreground">Repaid so far</p>
        <p class="font-semibold">
          {formatUint256(displayAmountRepaid.toString(), principalDecimals)}
          /
          {formatUint256(displayTotalDue.toString(), principalDecimals)}
          {principalSymbol}
        </p>
      </div>
    </div>

    <!-- Repayment progress bar -->
    <div class="space-y-1">
      <div class="flex justify-between text-xs text-muted-foreground">
        <span>Repayment progress</span>
        <span>{displayProgressPct}%</span>
      </div>
      <div class="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          class={cn(
            'h-full rounded-full transition-all duration-500',
            displayProgressPct === 100 ? 'bg-primary' : isOverdue ? 'bg-destructive' : 'bg-primary/70',
          )}
          style:width="{displayProgressPct}%"
        ></div>
      </div>
    </div>

    <!-- Partial payment history count -->
    {#if repaymentTxs.length > 0}
      <div class="flex items-center justify-between text-xs text-muted-foreground">
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

    <!-- Amount due + repay button (active loans only) -->
    {#if isActive}
      {#if chainError}
        <p class="text-xs text-destructive">{chainError}</p>
      {:else}
        <div
          class={cn(
            'rounded-lg px-4 py-3 flex items-center justify-between',
            isOverdue ? 'bg-destructive/10 border border-destructive/20' : 'bg-muted/60',
          )}
        >
          <div>
            <p class="text-xs text-muted-foreground">Amount due</p>
            <p class={cn('text-lg font-black', isOverdue && 'text-destructive')}>
              {formatUint256(displayRemaining.toString(), principalDecimals)}
              <span class="text-sm font-semibold">{principalSymbol}</span>
            </p>
          </div>
          {#if !showPaymentInput}
            <Button
              class="font-bold"
              onclick={() => (showPaymentInput = true)}
              size="sm"
              variant={isOverdue ? 'destructive' : 'default'}
            >
              Repay
            </Button>
          {/if}
        </div>

        {#if showPaymentInput}
          <div class="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div class="flex items-center gap-2">
              <input
                class="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                inputmode="decimal"
                placeholder="Amount to repay"
                type="text"
                bind:value={paymentInput}
              />
              <button
                class="text-xs text-primary hover:underline whitespace-nowrap"
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

            <div class="flex gap-2">
              <Button
                class="flex-1 font-bold"
                disabled={paymentRaw === 0n || paymentExceedsRemaining || txStatus === 'confirming' || txStatus === 'approving'}
                onclick={handleRepay}
                size="sm"
              >
                {txStatus === 'approving' ? 'Approving…' : txStatus === 'confirming' ? 'Confirming…' : 'Confirm Repayment'}
              </Button>
              <Button
                class="font-medium"
                disabled={txStatus === 'confirming' || txStatus === 'approving'}
                onclick={() => { showPaymentInput = false; txStatus = 'idle'; txError = ''; }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </div>
        {/if}
      {/if}
    {/if}
  </Card.Content>
</Card.Root>
