<script lang="ts">
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import TokenAutocomplete from '../ui/TokenAutocomplete.svelte';

  let {
    collateralAmount = $bindable(),
    borrowAmount = $bindable(),
    selectedCollateralToken = $bindable(),
    selectedBorrowToken = $bindable(),
    inputClass,
    sectionClass,
  }: {
    collateralAmount: string;
    borrowAmount: string;
    selectedCollateralToken: string;
    selectedBorrowToken: string;
    inputClass: string;
    sectionClass: string;
  } = $props();

  const collateralUsd = $derived(
    (parseFloat(collateralAmount) || 0) * tokenPrices.getTokenMeta(selectedCollateralToken).priceUsd,
  );
  const borrowUsd = $derived((parseFloat(borrowAmount) || 0) * tokenPrices.getTokenMeta(selectedBorrowToken).priceUsd);
</script>

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
        {collateralUsd > 0 ? `≈ $${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}
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
        {borrowUsd > 0 ? `≈ $${borrowUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}
      </span>
    </div>
  </div>
</div>
