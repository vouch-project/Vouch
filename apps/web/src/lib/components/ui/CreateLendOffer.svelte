<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import TokenAutocomplete from '$lib/components/ui/TokenAutocomplete.svelte';
  import { createLendOffer } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Loader2, Sparkles, Wallet } from '@lucide/svelte';

  let principalSymbol = $state('MOCK');
  let principalAmount = $state('');
  let collateralSymbol = $state('ETH');
  let minCollateral = $state('');
  let maxLtvPct = $state('65');
  let ratePct = $state('8');
  let durationDays = $state('30');
  let acceptWindowDays = $state('7');

  let submitting = $state(false);
  let errorMsg = $state<string | null>(null);

  const tokens = $derived(chainInfo.tokens ?? []);

  const principalToken = $derived(tokens.find((t) => t.symbol === principalSymbol) ?? null);
  const collateralToken = $derived(tokens.find((t) => t.symbol === collateralSymbol) ?? null);

  const principalUsd = $derived(
    (parseFloat(principalAmount) || 0) * tokenPrices.getTokenMeta(principalSymbol).priceUsd,
  );
  const collateralUsd = $derived(
    (parseFloat(minCollateral) || 0) * tokenPrices.getTokenMeta(collateralSymbol).priceUsd,
  );

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

  const RISK_LEVELS = {
    conservative: { ltv: '50', apr: '5.00', label: 'Conservative' },
    balanced:     { ltv: '65', apr: '8.00', label: 'Balanced' },
    aggressive:   { ltv: '80', apr: '12.00', label: 'Aggressive' },
  } as const;

  type RiskLevel = keyof typeof RISK_LEVELS;

  let selectedRisk = $state<RiskLevel | null>(null);

  const impliedLtv = $derived(
    principalUsd > 0 && collateralUsd > 0 ? (principalUsd / collateralUsd) * 100 : null,
  );

  const activeRisk = $derived.by<RiskLevel | null>(() => {
    if (selectedRisk !== null) return selectedRisk;
    if (impliedLtv === null) return null;
    const levels = Object.entries(RISK_LEVELS) as [RiskLevel, (typeof RISK_LEVELS)[RiskLevel]][];
    return levels.reduce((best, [key, val]) => {
      const bestDiff = Math.abs(parseFloat(RISK_LEVELS[best].ltv) - impliedLtv);
      const thisDiff = Math.abs(parseFloat(val.ltv) - impliedLtv);
      return thisDiff < bestDiff ? key : best;
    }, levels[0][0]);
  });

  const suggestedLtv = $derived(activeRisk ? RISK_LEVELS[activeRisk].ltv : '65');
  const suggestedApr = $derived(activeRisk ? RISK_LEVELS[activeRisk].apr : '8.00');

  const inputClass =
    'border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition w-full bg-background';
  const sectionClass = 'flex flex-col gap-3 p-4 rounded-lg border border-border/60 bg-muted/20';

  const handleSubmit = async () => {
    if (!principalToken || !collateralToken) return;
    submitting = true;
    errorMsg = null;
    try {
      await createLendOffer(
        principalToken,
        principalAmount,
        collateralToken,
        minCollateral,
        maxLtvBps,
        rateBps,
        durationSeconds,
        acceptWindowSeconds,
      );
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
    <!-- Principal + Collateral -->
    <div class="grid grid-cols-2 gap-3">
      <div class={sectionClass}>
        <p class="text-sm font-semibold text-foreground">Principal</p>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Token</span>
          <TokenAutocomplete {tokens} bind:value={principalSymbol} />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Amount</span>
          <input class={inputClass} inputmode="decimal" placeholder="0.0" type="text" bind:value={principalAmount} />
          <span class="text-xs text-muted-foreground min-h-4">
            {principalUsd > 0 ? `≈ $${principalUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}
          </span>
        </div>
      </div>

      <div class={sectionClass}>
        <p class="text-sm font-semibold text-foreground">Required Collateral</p>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Token</span>
          <TokenAutocomplete {tokens} bind:value={collateralSymbol} />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Min Amount</span>
          <input class={inputClass} inputmode="decimal" placeholder="0.0" type="text" bind:value={minCollateral} />
          <span class="text-xs text-muted-foreground min-h-4">
            {collateralUsd > 0 ? `≈ $${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}
          </span>
        </div>
      </div>
    </div>

    <!-- Risk level selector -->
    <div class="flex items-center gap-2">
      <span class="text-xs text-muted-foreground font-medium shrink-0">Risk level:</span>
      {#each Object.entries(RISK_LEVELS) as [key, level] (key)}
        <button
          class="flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors {activeRisk === key
            ? 'border-primary/40 bg-primary/15 text-primary'
            : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
          onclick={() => (selectedRisk = selectedRisk === key ? null : (key as RiskLevel))}
          type="button"
        >
          {level.label}
        </button>
      {/each}
      {#if impliedLtv !== null}
        <span class="text-xs text-muted-foreground ml-1">
          (implied LTV: {impliedLtv.toFixed(1)}%)
        </span>
      {/if}
    </div>

    <!-- Terms -->
    <div class="grid grid-cols-2 gap-3">
      <div class={sectionClass}>
        <p class="text-sm font-semibold text-foreground">Loan Terms</p>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between">
            <span class="text-xs text-muted-foreground font-medium">Max LTV (%)</span>
            <button
              class="group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors {maxLtvPct === suggestedLtv
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
              onclick={() => (maxLtvPct = suggestedLtv)}
              type="button"
            >
              <Sparkles class="h-3 w-3" />
              {suggestedLtv}%
            </button>
          </div>
          <div class="relative">
            <input class="{inputClass} pr-6" inputmode="decimal" max="100" min="1" placeholder="65" type="text" bind:value={maxLtvPct} />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between">
            <span class="text-xs text-muted-foreground font-medium">Interest Rate APR (%)</span>
            <button
              class="group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors {ratePct === suggestedApr
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
              onclick={() => (ratePct = suggestedApr)}
              type="button"
            >
              <Sparkles class="h-3 w-3" />
              {suggestedApr}%
            </button>
          </div>
          <div class="relative">
            <input class="{inputClass} pr-6" inputmode="decimal" max="100" min="0" placeholder="8" type="text" bind:value={ratePct} />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>
      </div>

      <div class={sectionClass}>
        <p class="text-sm font-semibold text-foreground">Timeline</p>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Loan Duration (days)</span>
          <div class="relative">
            <input class="{inputClass} pr-10" inputmode="decimal" min="1" placeholder="30" type="text" bind:value={durationDays} />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">days</span>
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Accept Window (days)</span>
          <div class="relative">
            <input class="{inputClass} pr-10" inputmode="decimal" min="1" placeholder="7" type="text" bind:value={acceptWindowDays} />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">days</span>
          </div>
        </div>
      </div>
    </div>

    {#if errorMsg}
      <p class="text-sm text-destructive">{errorMsg}</p>
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
