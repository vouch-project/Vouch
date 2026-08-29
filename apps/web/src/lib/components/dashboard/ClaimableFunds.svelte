<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { parseContractError } from '$lib/wallet/contractError';
  import { getPendingPayments, withdrawPayments } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Coins, LoaderCircle } from '@lucide/svelte';
  import { ethers } from 'ethers';
  import { SvelteMap } from 'svelte/reactivity';

  let { onClaimed }: { onClaimed?: () => void } = $props();

  type Claimable = { address: string; symbol: string; decimals: number; amount: bigint };

  let claimables = $state<Claimable[]>([]);
  let claiming = $state(false);
  let error = $state('');

  // Candidate tokens to check: native ETH plus every protocol token, de-duplicated by
  // address. Credited funds are always in a loan's principal token, so this set covers
  // every token a lender or the treasury could ever have pending.
  const candidateTokens = $derived.by(() => {
    const map = new SvelteMap<string, { address: string; symbol: string; decimals: number }>();
    map.set(ethers.ZeroAddress, { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18 });
    for (const t of chainInfo.tokens) {
      const address = !t.address || t.address === ethers.ZeroAddress ? ethers.ZeroAddress : t.address;
      map.set(address, { address, symbol: t.symbol, decimals: t.decimals });
    }
    return [...map.values()];
  });

  const scan = async () => {
    if (!wallet.isConnected || !wallet.address || !chainInfo.contractAddress) {
      claimables = [];
      return;
    }
    error = '';
    try {
      const tokens = candidateTokens;
      const results = await Promise.all(
        tokens.map(async (t) => ({ ...t, amount: await getPendingPayments(t.address) })),
      );
      claimables = results.filter((r) => r.amount > 0n);
    } catch (e) {
      // A read failure here shouldn't surface a scary banner; just hide it.
      claimables = [];
      console.error('Failed to check claimable funds:', e);
    }
  };

  const claimAll = async () => {
    if (claimables.length === 0 || claiming) return;
    claiming = true;
    error = '';
    try {
      // One withdrawal per token with a balance (almost always just one).
      for (const c of claimables) {
        await withdrawPayments(c.address);
      }
      await scan();
      onClaimed?.();
    } catch (e) {
      error = parseContractError(e, 'Claim failed');
    } finally {
      claiming = false;
    }
  };

  $effect(() => {
    // Re-scan whenever the wallet, chain, or token list changes.
    void wallet.address;
    void wallet.isConnected;
    void chainInfo.contractAddress;
    void chainInfo.tokens.length;
    void scan();
  });

  const formatAmount = (amount: bigint, decimals: number): string => {
    const formatted = ethers.formatUnits(amount, decimals);
    // Trim trailing zeros for a tidy display ("1.5000" → "1.5", "2.0" → "2").
    return formatted.includes('.') ? formatted.replace(/\.?0+$/, '') : formatted;
  };

  const summary = $derived(claimables.map((c) => `${formatAmount(c.amount, c.decimals)} ${c.symbol}`).join(' + '));
</script>

{#if claimables.length > 0}
  <Card.Root class="border-primary/30 bg-primary/5 backdrop-blur-sm">
    <Card.Content class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Coins class="h-5 w-5 text-primary" />
        </div>
        <div class="space-y-0.5">
          <p class="text-sm font-bold text-foreground">You have funds to claim</p>
          <p class="text-sm text-muted-foreground">
            A repayment couldn't be delivered to your wallet automatically and is being held safely for you: <span
              class="font-semibold text-foreground"
            >
              {summary}
            </span>.
          </p>
          {#if error}
            <p class="text-sm text-destructive">{error}</p>
          {/if}
        </div>
      </div>

      <Button class="shrink-0 font-bold" disabled={claiming} onclick={claimAll}>
        {#if claiming}
          <LoaderCircle class="h-4 w-4 animate-spin" />
          Claiming…
        {:else}
          Claim all
        {/if}
      </Button>
    </Card.Content>
  </Card.Root>
{/if}
