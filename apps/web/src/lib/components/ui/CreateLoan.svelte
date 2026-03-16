<script lang="ts">
  import { createLoan } from '$lib/wallet/vouchVault';

  let collateral = 1.0; // ETH
  let status = '';

  const handleCreateLoan = async () => {
    status = 'Waiting for wallet confirmation...';
    try {
      await createLoan(collateral);
      status = 'Loan created!';
    } catch (e) {
      status = e instanceof Error ? e.message : 'Transaction failed';
    }
  };
</script>

<form class="flex flex-col items-center gap-4 w-full max-w-sm" on:submit|preventDefault={handleCreateLoan}>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Collateral to Deposit (ETH):</span>
    <input
      min="0"
      step="0.01"
      type="number"
      bind:value={collateral}
      class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
    />
  </label>
  <button
    type="submit"
    class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg shadow transition disabled:opacity-60 disabled:cursor-not-allowed"
    disabled={status === 'Waiting for wallet confirmation...'}
  >
    {status === 'Waiting for wallet confirmation...' ? 'Processing...' : 'Create Loan'}
  </button>
  {#if status}
    <p class="text-sm mt-2 text-gray-500 text-center">{status}</p>
  {/if}
</form>
