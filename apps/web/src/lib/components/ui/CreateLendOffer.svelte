<script lang="ts">
  import type { Token } from '$api/chain';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { createLendOffer } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Loader2, Wallet } from '@lucide/svelte';

  let principalToken = $state<Token | null>(null);
  let principalAmount = $state('');
  let collateralToken = $state<Token | null>(null);
  let minCollateral = $state('');
  let maxLtvPct = $state('65');
  let ratePct = $state('8');
  let durationDays = $state('30');
  let acceptWindowDays = $state('7');

  let submitting = $state(false);
  let txHash = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);

  const tokens = $derived(chainInfo.tokens ?? []);

  const maxLtvBps = $derived(Math.round(parseFloat(maxLtvPct || '0') * 100));
  const rateBps = $derived(Math.round(parseFloat(ratePct || '0') * 100));
  const durationSeconds = $derived(Math.round(parseFloat(durationDays || '0') * 86400));
  const acceptWindowSeconds = $derived(Math.round(parseFloat(acceptWindowDays || '0') * 86400));

  const canSubmit = $derived(
    !!wallet.address &&
      !!principalToken &&
      !!collateralToken &&
      parseFloat(principalAmount) > 0 &&
      parseFloat(minCollateral) > 0 &&
      maxLtvBps > 0 &&
      rateBps >= 0 &&
      durationSeconds > 0 &&
      acceptWindowSeconds > 0 &&
      !submitting,
  );

  const handleSubmit = async () => {
    if (!principalToken || !collateralToken) return;
    submitting = true;
    errorMsg = null;
    txHash = null;
    try {
      const result = await createLendOffer(
        principalToken,
        principalAmount,
        collateralToken,
        minCollateral,
        maxLtvBps,
        rateBps,
        durationSeconds,
        acceptWindowSeconds,
      );
      txHash = result.receipt.hash;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Transaction failed';
    } finally {
      submitting = false;
    }
  };
</script>

<Card.Root class="bg-card/40 backdrop-blur-sm border-border/50 shadow-2xl shadow-primary/5">
  <Card.Header>
    <Card.Title class="text-2xl font-black tracking-tight flex items-center gap-2">
      <Wallet class="h-6 w-6 text-primary" />
      Create Lend Offer
    </Card.Title>
    <Card.Description class="text-muted-foreground">
      Lock your principal on-chain. A borrower posts collateral to accept.
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <!-- Principal -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="principal-token">Principal Token</label>
        <select
          id="principal-token"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          bind:value={principalToken}
        >
          <option value={null}>Select token</option>
          {#each tokens as token (token.address)}
            <option value={token}>{token.symbol}</option>
          {/each}
        </select>
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="principal-amount">Principal Amount</label>
        <input
          id="principal-amount"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          min="0"
          placeholder="0.00"
          step="any"
          type="number"
          bind:value={principalAmount}
        />
      </div>
    </div>

    <!-- Collateral requirements -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="collateral-token">Required Collateral Token</label>
        <select
          id="collateral-token"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          bind:value={collateralToken}
        >
          <option value={null}>Select token</option>
          {#each tokens as token (token.address)}
            <option value={token}>{token.symbol}</option>
          {/each}
        </select>
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="min-collateral">Min Collateral Amount</label>
        <input
          id="min-collateral"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          min="0"
          placeholder="0.00"
          step="any"
          type="number"
          bind:value={minCollateral}
        />
      </div>
    </div>

    <!-- Terms -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="max-ltv">Max LTV (%)</label>
        <input
          id="max-ltv"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          max="100"
          min="1"
          placeholder="65"
          step="0.01"
          type="number"
          bind:value={maxLtvPct}
        />
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="rate-pct">Interest Rate APR (%)</label>
        <input
          id="rate-pct"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          max="100"
          min="0"
          placeholder="8"
          step="0.01"
          type="number"
          bind:value={ratePct}
        />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="duration-days">Loan Duration (days)</label>
        <input
          id="duration-days"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          min="1"
          placeholder="30"
          step="1"
          type="number"
          bind:value={durationDays}
        />
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium text-foreground" for="accept-window">Accept Window (days)</label>
        <input
          id="accept-window"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          min="1"
          placeholder="7"
          step="1"
          type="number"
          bind:value={acceptWindowDays}
        />
      </div>
    </div>

    {#if errorMsg}
      <p class="text-sm text-destructive">{errorMsg}</p>
    {/if}

    {#if txHash}
      <p class="text-sm text-muted-foreground break-all">
        Offer created! Tx: <span class="font-mono text-foreground">{txHash}</span>
      </p>
    {/if}
  </Card.Content>
  <Card.Footer>
    {#if !wallet.address}
      <p class="text-sm text-muted-foreground">Connect your wallet to create an offer.</p>
    {:else}
      <Button class="w-full font-bold" disabled={!canSubmit} onclick={handleSubmit} size="lg">
        {#if submitting}
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          Creating Offer…
        {:else}
          Create Lend Offer
        {/if}
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>
