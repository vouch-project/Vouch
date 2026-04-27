<script lang="ts">
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { createLoan } from '$lib/wallet/vouchVault';
  import TokenAutocomplete from './TokenAutocomplete.svelte';

  let collateralAmount = $state('1.0');
  let borrowAmount = $state('');
  let status = $state('');
  let selectedCollateralToken = $state('ETH');
  let selectedBorrowToken = $state('USDC');

  const handleCreateLoan = async (e: SubmitEvent) => {
    e.preventDefault();
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
    } catch (e) {
      status = e instanceof Error ? e.message : 'Transaction failed';
    }
  };
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
  </label>
  <button
    class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg shadow transition disabled:opacity-60 disabled:cursor-not-allowed"
    disabled={status === 'Waiting for wallet confirmation...'}
    type="submit"
  >
    {status === 'Waiting for wallet confirmation...' ? 'Processing...' : 'Create Loan'}
  </button>
  {#if status}
    <p class="text-sm mt-2 text-gray-500 text-center">{status}</p>
  {/if}
</form>
