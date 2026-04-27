<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { createLoan } from '$lib/wallet/vouchVault';
  import TokenAutocomplete from './TokenAutocomplete.svelte';
  import { getTokenMeta, maxLtv } from '$lib/ltv';

  // ── Form state ────────────────────────────────────────────────────────────
  let collateralAmount = $state('1.0');
  let borrowAmount = $state('');
  let status = $state('');
  let selectedCollateralToken = $state('ETH');
  let selectedBorrowToken = $state('MOCK');

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
      await createLoan(collateralAmount, collateralToken, borrowToken, borrowAmount);
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
</script>

<form class="flex flex-col items-center gap-4 w-full max-w-sm" onsubmit={handleCreateLoan}>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Collateral Token:</span>
    <TokenAutocomplete tokens={chainInfo.tokens} bind:value={selectedCollateralToken} />
  </label>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Collateral to Deposit ({selectedCollateralToken}):</span>
    <input
      class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
      inputmode="decimal"
      placeholder="0.0"
      type="text"
      bind:value={collateralAmount}
    />
    <span class="text-xs text-gray-400 min-h-4 block">
      {collateralUsd > 0 ? `≈ $${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
    </span>
  </label>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Borrow Currency:</span>
    <TokenAutocomplete tokens={chainInfo.tokens} bind:value={selectedBorrowToken} />
  </label>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Amount to Borrow ({selectedBorrowToken}):</span>
    <input
      class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
      inputmode="decimal"
      placeholder="0.0"
      type="text"
      bind:value={borrowAmount}
    />
    <span class="text-xs text-gray-400 min-h-4 block">
      {borrowUsd > 0 ? `≈ $${borrowUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
    </span>
  </label>

  <!-- LTV Indicator -->
  <div
    class="w-full rounded-lg border px-4 py-3 space-y-2 {ltvExceeded
      ? 'border-red-300 bg-red-50'
      : 'border-gray-200 bg-gray-50'}"
  >
    <div class="flex justify-between text-xs font-semibold {ltvExceeded ? 'text-red-600' : 'text-gray-500'}">
      <span>Loan-to-Value (LTV)</span>
      <span>Max: {computedMaxLtv.toFixed(1)}%{creditScore !== null ? ` (score ${creditScore})` : ''}</span>
    </div>

    <!-- Bar -->
    <div class="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <!-- Max LTV marker -->
      <div
        style:left="{(computedMaxLtv / (computedMaxLtv + 5)) * 100}%"
        class="absolute top-0 h-full w-0.5 bg-gray-400 z-10"
      ></div>
      <!-- Current LTV fill -->
      <div
        style:width="{collateralUsd > 0 ? Math.min((currentLtv / (computedMaxLtv + 5)) * 100, 100) : 0}%"
        class="h-full rounded-full transition-all duration-300 {ltvExceeded ? 'bg-red-500' : 'bg-blue-500'}"
      ></div>
    </div>

    <div class="flex justify-between items-center">
      <span class="text-sm font-bold {ltvExceeded ? 'text-red-600' : 'text-gray-700'}">
        {currentLtv > 0 ? `${currentLtv.toFixed(1)}%` : '—'}
      </span>
      {#if ltvExceeded}
        <span class="text-xs font-semibold text-red-500">Exceeds max LTV ↑</span>
      {:else if currentLtv > 0}
        <span class="text-xs text-gray-400">{(computedMaxLtv - currentLtv).toFixed(1)}% remaining</span>
      {/if}
    </div>
  </div>

  <button
    class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg shadow transition disabled:opacity-60 disabled:cursor-not-allowed {ltvExceeded
      ? '!bg-red-500 hover:!bg-red-600'
      : ''}"
    disabled={isSubmitting || ltvExceeded}
    type="submit"
  >
    {isSubmitting ? 'Processing...' : ltvExceeded ? 'LTV Exceeded' : 'Create Loan'}
  </button>

  {#if status}
    <p
      class="text-sm mt-2 {status === 'Loan created!'
        ? 'text-green-600'
        : ltvExceeded || status.includes('exceeds')
          ? 'text-red-500'
          : 'text-gray-500'} text-center"
    >
      {status}
    </p>
  {/if}
</form>
