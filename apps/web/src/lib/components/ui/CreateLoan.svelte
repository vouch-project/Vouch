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

<div>
  <label>Collateral to Deposit (ETH): <input min="0" step="0.01" type="number" bind:value={collateral} /></label>
  <button type="submit" on:click={handleCreateLoan}>Create Loan</button>
  <p>{status}</p>
</div>
