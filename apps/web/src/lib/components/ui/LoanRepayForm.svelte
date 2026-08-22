<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { formatUint256 } from '$lib/formatUint256';
  import type { LoanFull } from '$lib/types';
  import { cn } from '$lib/utils';
  import { txExplorerUrl } from '$lib/wallet/explorer';
  import { getRepaymentDetails, repayLoan, type RepaymentDetails } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { ExternalLink } from '@lucide/svelte';
  import { ethers } from 'ethers';

  type Props = {
    onChainLoanId: string;
    principalDecimals: number;
    principalSymbol: string;
    isEthPrincipal: boolean;
    principalTokenAddress?: string;
    remaining: bigint;
    isOverdue: boolean;
    repaymentTxs: LoanFull['repaymentTransactions'];
    onPaid: (details: RepaymentDetails) => void;
    onClose: () => void;
  };

  let {
    onChainLoanId,
    principalDecimals,
    principalSymbol,
    isEthPrincipal,
    principalTokenAddress,
    remaining,
    isOverdue,
    repaymentTxs,
    onPaid,
    onClose,
  }: Props = $props();

  let paymentInput = $state('');
  let txStatus = $state<'idle' | 'approving' | 'confirming' | 'success' | 'error'>('idle');
  let txError = $state('');

  const paymentRaw = $derived.by(() => {
    if (!paymentInput.trim()) return 0n;
    try {
      return ethers.parseUnits(paymentInput, principalDecimals);
    } catch {
      return 0n;
    }
  });

  const paymentExceedsRemaining = $derived(paymentRaw > remaining);

  const setFullPayment = () => {
    paymentInput = ethers.formatUnits(remaining, principalDecimals);
  };

  const handleRepay = async () => {
    if (paymentRaw === 0n || paymentExceedsRemaining) return;

    txStatus = 'confirming';
    txError = '';

    try {
      if (!isEthPrincipal) txStatus = 'approving';
      await repayLoan(BigInt(onChainLoanId), paymentRaw, isEthPrincipal ? undefined : principalTokenAddress);

      txStatus = 'success';
      paymentInput = '';

      // Refresh chain state after payment and hand it back to the parent.
      onPaid(await getRepaymentDetails(BigInt(onChainLoanId)));
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
    txStatus === 'approving'
      ? 'Approve token, then confirm repayment…'
      : txStatus === 'confirming'
        ? 'Confirm in wallet…'
        : '',
  );

  // Latest repayment tx for the history link
  const latestTx = $derived(
    [...repaymentTxs].sort((a, b) => new Date(b.txTimestamp).getTime() - new Date(a.txTimestamp).getTime())[0] ?? null,
  );

  const isBusy = $derived(txStatus === 'confirming' || txStatus === 'approving');
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
  <!-- Amount due -->
  <div class="min-w-0">
    <p class="text-xs text-muted-foreground">Amount due</p>
    <p class={cn('text-lg font-black', isOverdue && 'text-destructive')}>
      {formatUint256(remaining.toString(), principalDecimals, principalDecimals)}
      <span class="text-sm font-semibold">{principalSymbol}</span>
    </p>
    {#if repaymentTxs.length > 0}
      <div class="flex items-center gap-2 text-xs text-muted-foreground mt-1">
        <span>{repaymentTxs.length} payment{repaymentTxs.length > 1 ? 's' : ''} recorded</span>
        {#if latestTx}
          <a
            class="flex items-center gap-1 hover:text-foreground transition-colors"
            href={txExplorerUrl(wallet.networkId, latestTx.txHash)}
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
        disabled={paymentRaw === 0n || paymentExceedsRemaining || isBusy}
        onclick={handleRepay}
        size="sm"
      >
        {txStatus === 'approving'
          ? 'Approve + repay…'
          : txStatus === 'confirming'
            ? 'Confirming…'
            : 'Confirm Repayment'}
      </Button>
      <Button
        class="font-medium text-muted-foreground hover:text-foreground"
        disabled={isBusy}
        onclick={() => {
          txStatus = 'idle';
          txError = '';
          onClose();
        }}
        size="sm"
        variant="outline"
      >
        Cancel
      </Button>
    </div>
  </div>
</div>
