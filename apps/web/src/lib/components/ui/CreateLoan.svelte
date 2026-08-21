<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import { calculateHealthFactor } from '$lib/loans/loanMath';
  import { maxLtv } from '$lib/ltv';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import { createLoan } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import CollateralBorrowFields from '../create-loan/CollateralBorrowFields.svelte';
  import LoanTermsFields from '../create-loan/LoanTermsFields.svelte';
  import LtvIndicator from '../create-loan/LtvIndicator.svelte';
  import RepaymentSummary from '../create-loan/RepaymentSummary.svelte';

  // ── Form state ────────────────────────────────────────────────────────────
  let collateralAmount = $state('1.0');
  let borrowAmount = $state('');
  let status = $state('');
  let selectedCollateralToken = $state('ETH');
  let selectedBorrowToken = $state('MOCK');

  let interestRatePct = $state('5');
  let durationDays = $state('30');
  let fundWindowDays = $state('7');

  // Credit score (fetched once when address is known)
  let creditScore = $state<number | null>(null);

  $effect(() => {
    if (!wallet.address) {
      creditScore = null;
      return;
    }
    axiosApi
      .get<{ score: number }>(`/scoring/${wallet.address}`)
      .then(({ data }) => {
        creditScore = data.score;
      })
      .catch(() => {
        creditScore = null;
      });
  });

  // ── LTV Calculations ──────────────────────────────────────────────────────
  const collateralMeta = $derived(tokenPrices.getTokenMeta(selectedCollateralToken));
  const borrowMeta = $derived(tokenPrices.getTokenMeta(selectedBorrowToken));
  const computedMaxLtv = $derived(maxLtv(collateralMeta, borrowMeta, creditScore));
  const collateralUsd = $derived((parseFloat(collateralAmount) || 0) * collateralMeta.priceUsd);
  const borrowUsd = $derived((parseFloat(borrowAmount) || 0) * borrowMeta.priceUsd);
  const currentLtv = $derived(collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0);
  const ltvExceeded = $derived(currentLtv > computedMaxLtv);
  const projectedHf = $derived(calculateHealthFactor(collateralUsd, borrowUsd, computedMaxLtv));

  // ── Recommended APR (credit score + LTV risk) ────────────────────────────
  // Score sets the ceiling (300→15%, 850→5%). LTV utilization scales it down:
  // borrowing 10% of max LTV → 10% of that ceiling. No borrow entered → null.
  const recommendedApr = $derived.by(() => {
    if (creditScore === null || currentLtv <= 0 || computedMaxLtv <= 0) return null;
    const scoreNorm = Math.max(0, Math.min(1, (creditScore - 300) / 550));
    const ceiling = 5 + (1 - scoreNorm) * 10;
    const ltvRatio = Math.min(1, currentLtv / computedMaxLtv);
    return ceiling * ltvRatio;
  });

  // ── Repayment ─────────────────────────────────────────────────────────────
  const totalRepayment = $derived.by(() => {
    const principal = parseFloat(borrowAmount) || 0;
    const rate = parseFloat(interestRatePct) || 0;
    const days = parseInt(durationDays) || 0;
    if (principal <= 0 || days <= 0) return null;
    const interest = principal * (rate / 100) * (days / 365);
    return { total: principal + interest, interest };
  });

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleCreateLoan = async (e: SubmitEvent) => {
    e.preventDefault();

    const collateralValue = Number(collateralAmount);
    if (!collateralAmount.trim() || !isFinite(collateralValue) || collateralValue <= 0) {
      status = 'Enter a valid collateral amount greater than 0.';
      return;
    }

    const borrowValue = Number(borrowAmount);
    if (!borrowAmount.trim() || !isFinite(borrowValue) || borrowValue <= 0) {
      status = 'Enter a valid borrow amount greater than 0.';
      return;
    }

    if (ltvExceeded) {
      status = 'Borrow amount exceeds the maximum LTV. Reduce the amount or add more collateral.';
      return;
    }

    const ratePct = Number(interestRatePct);
    if (!isFinite(ratePct) || ratePct < 0) {
      status = 'Enter a valid interest rate of 0% APR or higher.';
      return;
    }
    if (ratePct > 100) {
      status = 'Interest rate cannot exceed 100% APR.';
      return;
    }
    const durDays = Number(durationDays);
    if (!Number.isInteger(durDays) || durDays <= 0) {
      status = 'Loan duration must be a positive whole number of days.';
      return;
    }
    const windowDays = Number(fundWindowDays);
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
      status = 'Funding window must be a positive whole number of days.';
      return;
    }
    const interestRateBps = Math.round(ratePct * 100);
    const durationSeconds = durDays * 86400;
    if (!Number.isSafeInteger(durationSeconds)) {
      status = 'Loan duration is too large.';
      return;
    }
    const fundWindowSeconds = windowDays * 86400;
    if (!Number.isSafeInteger(fundWindowSeconds)) {
      status = 'Funding window is too large.';
      return;
    }

    status = 'Waiting for wallet confirmation...';

    const collateralToken = chainInfo.tokens.find((t) => t.symbol === selectedCollateralToken);
    if (!collateralToken) {
      status = 'Collateral token not found';
      return;
    }

    const borrowToken = chainInfo.tokens.find((t) => t.symbol === selectedBorrowToken);
    if (!borrowToken) {
      status = 'Borrow token not found';
      return;
    }

    try {
      const liquidationThresholdBps = Math.max(1, Math.min(10000, Math.round(computedMaxLtv * 100)));
      await createLoan(
        collateralAmount,
        collateralToken,
        borrowToken,
        borrowAmount,
        interestRateBps,
        durationSeconds,
        fundWindowSeconds,
        liquidationThresholdBps,
      );
      status = 'Loan created!';
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ACTION_REJECTED') {
        status = 'Transaction rejected by user.';
      } else if (e && typeof e === 'object' && 'info' in e) {
        const info = (e as { info?: { error?: { message?: string } } }).info;
        status = info?.error?.message ?? 'Transaction failed';
      } else {
        status = e instanceof Error ? e.message : 'Transaction failed';
      }
    }
  };

  const isSubmitting = $derived(status === 'Waiting for wallet confirmation...');

  const inputClass =
    'border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition w-full bg-background';
  const sectionClass = 'flex flex-col gap-3 p-4 rounded-lg border border-border/60 bg-muted/20';
</script>

<form class="flex flex-col gap-5 w-full" onsubmit={handleCreateLoan}>
  <CollateralBorrowFields
    {inputClass}
    {sectionClass}
    bind:collateralAmount
    bind:borrowAmount
    bind:selectedCollateralToken
    bind:selectedBorrowToken
  />

  <LoanTermsFields
    {inputClass}
    {recommendedApr}
    {sectionClass}
    bind:interestRatePct
    bind:durationDays
    bind:fundWindowDays
  />

  <LtvIndicator {computedMaxLtv} {creditScore} {currentLtv} {ltvExceeded} {projectedHf} />

  <RepaymentSummary
    interest={totalRepayment?.interest ?? 0}
    tokenSymbol={selectedBorrowToken}
    total={totalRepayment?.total ?? 0}
    empty={totalRepayment === null}
  />

  <button
    class="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-2.5 rounded-lg shadow transition disabled:opacity-60 disabled:cursor-not-allowed {ltvExceeded
      ? '!bg-destructive hover:!bg-destructive/90'
      : ''}"
    disabled={isSubmitting || ltvExceeded}
    type="submit"
  >
    {isSubmitting ? 'Processing...' : ltvExceeded ? 'LTV Exceeded' : 'Create Loan'}
  </button>

  {#if status}
    <p
      class="text-sm {status === 'Loan created!'
        ? 'text-green-600'
        : ltvExceeded || status.includes('exceeds')
          ? 'text-destructive'
          : 'text-muted-foreground'} text-center"
    >
      {status}
    </p>
  {/if}
</form>
