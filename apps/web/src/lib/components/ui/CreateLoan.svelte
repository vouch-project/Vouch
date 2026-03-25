<script lang="ts">
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { createLoan } from '$lib/wallet/vouchVault';
  import TokenAutocomplete from './TokenAutocomplete.svelte';

  let collateralAmount = $state(1.0);
  let status = $state('');
  let selectedToken = $state('ETH');

  const handleCreateLoan = async () => {
    status = 'Waiting for wallet confirmation...';
    const token = chainInfo.tokens.find((t) => t.symbol === selectedToken);
    if (!token) {
      status = 'Selected token not found';
      return;
    }

    try {
      await createLoan(collateralAmount, token);
      status = 'Loan created!';
    } catch (e) {
      status = e instanceof Error ? e.message : 'Transaction failed';
    }
  };
</script>

<form class="flex flex-col items-center gap-4 w-full max-w-sm" onsubmit={handleCreateLoan}>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Collateral Token:</span>
    <TokenAutocomplete tokens={chainInfo.tokens} bind:value={selectedToken} />
  </label>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Collateral to Deposit ({selectedToken}):</span>
    <input
      class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
      min="0"
      step="0.01"
      type="number"
      bind:value={collateralAmount}
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
