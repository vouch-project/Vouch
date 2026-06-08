<script lang="ts">
  import { ethers } from 'ethers';
  import { AlertCircle, CheckCircle2, Clock, Coins, Hourglass, TrendingUp } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import { formatUint256 } from '$lib/formatUint256';
  import { repayLoan, repayLoanWithERC20, getRepaymentDetails, type RepaymentDetails } from '$lib/wallet/vouchVault';
  import type { LoanWithTokens } from '$lib/types';

  type Props = {
    loan: LoanWithTokens;
    onRepaid?: () => void;
  };

  let { loan, onRepaid }: Props = $props();

  // ── Repayment state ──────────────────────────────────────────────────────
  let repaymentDetails = $state<RepaymentDetails | null>(null);
  let loadError = $state('');
  let paymentInput = $state('');
  let txStatus = $state<'idle' | 'approving' | 'confirming' | 'success' | 'error'>('idle');
  let txError = $state('');
  let showPaymentInput = $state(false);

  const isEthPrincipal = $derived(
    !loan.principalToken?.address || loan.principalToken.address === ethers.ZeroAddress,
  );

  const principalDecimals = $derived(loan.principalToken?.decimals ?? 18);
  const principalSymbol = $derived(loan.principalToken?.symbol ?? 'ETH');

  // Load repayment details from chain on mount
  $effect(() => {
    if (loan.onChainLoanId === null) return;
    getRepaymentDetails(BigInt(loan.onChainLoanId))
      .then((d) => {
        repaymentDetails = d;
      })
      .catch((e) => {
        loadError = (e as Error).message;
      });
  });

  // ── Due date helpers ──────────────────────────────────────────────────────
  const dueDate = $derived.by(() => {
    if (!repaymentDetails || repaymentDetails.durationSeconds === 0n) return null;
    if (!loan.fundedAt) return null;
    const fundedMs = new Date(loan.fundedAt).getTime();
    return new Date(fundedMs + Number(repaymentDetails.durationSeconds) * 1000);
  });

  const isOverdue = $derived(dueDate ? dueDate < new Date() : false);

  const dueDateLabel = $derived.by(() => {
    if (!dueDate) return 'No deadline';
    const diff = dueDate.getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return `Overdue by ${Math.abs(days)}d`;
    if (days === 0) return 'Due today';
    return `Due in ${days}d`;
  });

  // ── Progress bar ─────────────────────────────────────────────────────────
  const progressPct = $derived.by(() => {
    if (!repaymentDetails || repaymentDetails.totalDue === 0n) return 0;
    return Number((repaymentDetails.amountRepaid * 100n) / repaymentDetails.totalDue);
  });

  // ── Payment helpers ───────────────────────────────────────────────────────
  const remainingFormatted = $derived(
    repaymentDetails ? formatUint256(repaymentDetails.remaining.toString(), principalDecimals) : '—',
  );

  const totalDueFormatted = $derived(
    repaymentDetails ? formatUint256(repaymentDetails.totalDue.toString(), principalDecimals) : '—',
  );

  const amountRepaidFormatted = $derived(
    repaymentDetails ? formatUint256(repaymentDetails.amountRepaid.toString(), principalDecimals) : '—',
  );

  const interestFormatted = $derived.by(() => {
    if (!repaymentDetails || !loan.principalAmount) return '—';
    const principal = BigInt(loan.principalAmount);
    const interest = repaymentDetails.totalDue - principal;
    return formatUint256(interest.toString(), principalDecimals);
  });

  // Parse payment input to raw bigint
  const paymentRaw = $derived.by(() => {
    if (!paymentInput.trim()) return 0n;
    try {
      return ethers.parseUnits(paymentInput, principalDecimals);
    } catch {
      return 0n;
    }
  });

  const paymentExceedsRemaining = $derived(
    repaymentDetails ? paymentRaw > repaymentDetails.remaining : false,
  );

  const setFullPayment = () => {
    if (!repaymentDetails) return;
    paymentInput = ethers.formatUnits(repaymentDetails.remaining, principalDecimals);
  };

  // ── Repay action ──────────────────────────────────────────────────────────
  const handleRepay = async () => {
    if (!repaymentDetails || paymentRaw === 0n || paymentExceedsRemaining) return;
    if (loan.onChainLoanId === null) return;

    txStatus = 'confirming';
    txError = '';

    try {
      if (isEthPrincipal) {
        await repayLoan(BigInt(loan.onChainLoanId), paymentRaw);
      } else {
        txStatus = 'approving';
        await repayLoanWithERC20(
          BigInt(loan.onChainLoanId),
          paymentRaw,
          loan.principalToken!.address,
        );
      }

      txStatus = 'success';
      paymentInput = '';
      showPaymentInput = false;

      // Refresh repayment details from chain
      const updated = await getRepaymentDetails(BigInt(loan.onChainLoanId));
      repaymentDetails = updated;

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

  const statusLabel = $derived.by(() => {
    if (txStatus === 'approving') return 'Approving token…';
    if (txStatus === 'confirming') return 'Confirm in wallet…';
    return '';
  });
</script>

<Card.Root
  class={cn(
    'bg-card/60 backdrop-blur-sm border-border/50 overflow-hidden transition-all duration-300',
    isOverdue && 'border-destructive/40',
    repaymentDetails?.repaid && 'opacity-60',
  )}
>
  <!-- Top accent bar: progress -->
  <div class="h-1 w-full bg-muted">
    <div
      class={cn(
        'h-full transition-all duration-500',
        progressPct === 100 ? 'bg-primary' : isOverdue ? 'bg-destructive' : 'bg-primary/70',
      )}
      style:width="{progressPct}%"
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
        {#if repaymentDetails?.repaid}
          <Badge variant="outline" class="text-primary border-primary/40 text-xs gap-1">
            <CheckCircle2 class="h-3 w-3" /> Repaid
          </Badge>
        {:else if isOverdue}
          <Badge variant="destructive" class="text-xs gap-1">
            <AlertCircle class="h-3 w-3" /> Overdue
          </Badge>
        {:else}
          <Badge variant="secondary" class="text-xs gap-1">
            <Clock class="h-3 w-3" /> Active
          </Badge>
        {/if}
      </div>
    </div>
  </Card.Header>

  <Card.Content class="space-y-4">
    {#if loadError}
      <p class="text-xs text-destructive">{loadError}</p>
    {:else if !repaymentDetails}
      <!-- Skeleton -->
      <div class="space-y-2">
        {#each [1, 2, 3] as _}
          <div class="h-4 bg-muted animate-pulse rounded"></div>
        {/each}
      </div>
    {:else}
      <!-- Stats grid -->
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
            {interestFormatted} {principalSymbol}
            <span class="text-muted-foreground text-xs font-normal">
              ({(repaymentDetails.interestRateBps / 100).toFixed(2)}%)
            </span>
          </p>
        </div>

        <div class="space-y-0.5">
          <p class="text-xs text-muted-foreground flex items-center gap-1">
            <Hourglass class="h-3 w-3" /> Due date
          </p>
          <p class={cn('font-semibold text-sm', isOverdue && 'text-destructive')}>
            {dueDateLabel}
          </p>
        </div>

        <div class="space-y-0.5">
          <p class="text-xs text-muted-foreground">Repaid so far</p>
          <p class="font-semibold">
            {amountRepaidFormatted} / {totalDueFormatted}
            {principalSymbol}
          </p>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="space-y-1">
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>Repayment progress</span>
          <span>{progressPct}%</span>
        </div>
        <div class="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            class={cn(
              'h-full rounded-full transition-all duration-500',
              progressPct === 100 ? 'bg-primary' : isOverdue ? 'bg-destructive' : 'bg-primary/70',
            )}
            style:width="{progressPct}%"
          ></div>
        </div>
      </div>

      <!-- Amount due highlight -->
      {#if !repaymentDetails.repaid}
        <div
          class={cn(
            'rounded-lg px-4 py-3 flex items-center justify-between',
            isOverdue ? 'bg-destructive/10 border border-destructive/20' : 'bg-muted/60',
          )}
        >
          <div>
            <p class="text-xs text-muted-foreground">Amount due</p>
            <p class={cn('text-lg font-black', isOverdue && 'text-destructive')}>
              {remainingFormatted}
              <span class="text-sm font-semibold">{principalSymbol}</span>
            </p>
          </div>
          {#if !showPaymentInput}
            <Button
              size="sm"
              variant={isOverdue ? 'destructive' : 'default'}
              class="font-bold"
              onclick={() => (showPaymentInput = true)}
            >
              Repay
            </Button>
          {/if}
        </div>

        <!-- Inline payment form -->
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
            {:else if statusLabel}
              <p class="text-xs text-muted-foreground">{statusLabel}</p>
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
