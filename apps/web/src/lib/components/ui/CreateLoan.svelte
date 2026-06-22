<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import { getTokenMeta, maxLtv } from '$lib/ltv';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { createLoan } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import TokenAutocomplete from './TokenAutocomplete.svelte';

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
  const computedMaxLtv = $derived(maxLtv(selectedCollateralToken, selectedBorrowToken, creditScore));

  const collateralUsd = $derived((parseFloat(collateralAmount) || 0) * getTokenMeta(selectedCollateralToken).priceUsd);

  const borrowUsd = $derived((parseFloat(borrowAmount) || 0) * getTokenMeta(selectedBorrowToken).priceUsd);

  const currentLtv = $derived(collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0);

  const ltvExceeded = $derived(currentLtv > computedMaxLtv);

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
    if (!isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
      status = 'Enter a valid interest rate between 0 and 100% APR.';
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
    const interestRateBps = Math.round(ratePct * 100); // 5% -> 500 bps
    const durationSeconds = durDays * 86400;
    const fundWindowSeconds = windowDays * 86400;

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
      await createLoan(
        collateralAmount,
        collateralToken,
        borrowToken,
        borrowAmount,
        interestRateBps,
        durationSeconds,
        fundWindowSeconds,
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

  const inputClass = 'border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition w-full bg-background';
  const sectionClass = 'flex flex-col gap-3 p-4 rounded-lg border border-border/60 bg-muted/20';
</script>

<form class="flex flex-col gap-5 w-full" onsubmit={handleCreateLoan}>
  <!-- Collateral + Borrow side-by-side -->
  <div class="grid grid-cols-2 gap-4">
    <div class={sectionClass}>
      <p class="text-sm font-semibold text-foreground">Collateral</p>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground font-medium">Token</span>
        <TokenAutocomplete tokens={chainInfo.tokens} bind:value={selectedCollateralToken} />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground font-medium">Amount</span>
        <input class={inputClass} inputmode="decimal" placeholder="0.0" type="text" bind:value={collateralAmount} />
        <span class="text-xs text-muted-foreground min-h-4">
          {collateralUsd > 0 ? `≈ $${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
        </span>
      </div>
    </div>

    <div class={sectionClass}>
      <p class="text-sm font-semibold text-foreground">Borrow</p>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground font-medium">Token</span>
        <TokenAutocomplete tokens={chainInfo.tokens} bind:value={selectedBorrowToken} />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground font-medium">Amount</span>
        <input class={inputClass} inputmode="decimal" placeholder="0.0" type="text" bind:value={borrowAmount} />
        <span class="text-xs text-muted-foreground min-h-4">
          {borrowUsd > 0 ? `≈ $${borrowUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
        </span>
      </div>
    </div>
  </div>

  <!-- Loan Terms: APR, Duration, Fund Window in one row -->
  <div class={sectionClass}>
    <p class="text-sm font-semibold text-foreground">Loan Terms</p>
    <div class="grid grid-cols-3 gap-3">
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground font-medium">APR %</span>
        <input class={inputClass} inputmode="decimal" placeholder="5" type="text" bind:value={interestRatePct} />
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground font-medium">Duration</span>
        <div class="relative">
          <input class="{inputClass} pr-10" inputmode="numeric" min="1" placeholder="30" type="number" bind:value={durationDays} />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">days</span>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground font-medium">Fund within</span>
        <div class="relative">
          <input class="{inputClass} pr-10" inputmode="numeric" min="1" placeholder="7" type="number" bind:value={fundWindowDays} />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">days</span>
        </div>
      </div>
    </div>
  </div>

  <!-- LTV Indicator -->
  <div
    class="w-full rounded-lg border px-4 py-3 space-y-2 {ltvExceeded
      ? 'border-destructive/50 bg-destructive/5'
      : 'border-border/60 bg-muted/20'}"
  >
    <div class="flex justify-between text-xs font-semibold {ltvExceeded ? 'text-destructive' : 'text-muted-foreground'}">
      <span>Loan-to-Value (LTV)</span>
      <span>Max: {computedMaxLtv.toFixed(1)}%{creditScore !== null ? ` (score ${creditScore})` : ''}</span>
    </div>

    <div class="relative w-full h-2 bg-muted rounded-full overflow-hidden">
      <div
        style:left="{(computedMaxLtv / (computedMaxLtv + 5)) * 100}%"
        class="absolute top-0 h-full w-0.5 bg-muted-foreground/40 z-10"
      ></div>
      <div
        style:width="{collateralUsd > 0 ? Math.min((currentLtv / (computedMaxLtv + 5)) * 100, 100) : 0}%"
        class="h-full rounded-full transition-all duration-300 {ltvExceeded ? 'bg-destructive' : 'bg-primary'}"
      ></div>
    </div>

    <div class="flex justify-between items-center">
      <span class="text-sm font-bold {ltvExceeded ? 'text-destructive' : 'text-foreground'}">
        {currentLtv > 0 ? `${currentLtv.toFixed(1)}%` : '—'}
      </span>
      {#if ltvExceeded}
        <span class="text-xs font-semibold text-destructive">Exceeds max LTV ↑</span>
      {:else if currentLtv > 0}
        <span class="text-xs text-muted-foreground">{(computedMaxLtv - currentLtv).toFixed(1)}% remaining</span>
      {/if}
    </div>
  </div>

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
