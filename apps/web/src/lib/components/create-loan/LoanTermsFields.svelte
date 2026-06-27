<script lang="ts">
  import { Sparkles } from '@lucide/svelte';

  let {
    interestRatePct = $bindable(),
    durationDays = $bindable(),
    fundWindowDays = $bindable(),
    recommendedApr,
    inputClass,
    sectionClass,
  }: {
    interestRatePct: string;
    durationDays: string;
    fundWindowDays: string;
    recommendedApr: number | null;
    inputClass: string;
    sectionClass: string;
  } = $props();

  const handleAprInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    if (v < 0) {
      interestRatePct = '0';
      input.value = '0';
      return;
    }
    // The on-chain rate is capped at 10000 bps (100% APR); clamp to match so the
    // create-loan transaction can't revert on "Interest rate cannot exceed 100%".
    if (v > 100) {
      interestRatePct = '100';
      input.value = '100';
      return;
    }
    // The on-chain rate is stored as basis points, so APR only supports 2
    // decimal places of percent. Trim any extra precision as the user types.
    const dot = input.value.indexOf('.');
    if (dot !== -1 && input.value.length - dot - 1 > 2) {
      const trimmed = (Math.round(v * 100) / 100).toFixed(2);
      interestRatePct = trimmed;
      input.value = trimmed;
    }
  };

  const handleDurationInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (parseInt(input.value) < 1) input.value = '1';
  };

  const handleFundWindowInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (parseInt(input.value) < 1) input.value = '1';
  };
</script>

<div class={sectionClass}>
  <p class="text-sm font-semibold text-foreground">Loan Terms</p>
  <div class="grid grid-cols-3 gap-3">
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between">
        <span class="text-xs text-muted-foreground font-medium">APR %</span>
        {#if recommendedApr !== null}
          {@const recommended = recommendedApr.toFixed(2)}
          <button
            class="group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors {interestRatePct ===
            recommended
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
            onclick={() => (interestRatePct = recommended)}
            title="Use the recommended APR for your credit score and LTV"
            type="button"
          >
            <Sparkles class="h-3 w-3" />
            {recommended}%
          </button>
        {/if}
      </div>
      <div class="relative">
        <input
          class="{inputClass} pr-6"
          min="0"
          max="100"
          oninput={handleAprInput}
          placeholder={recommendedApr !== null ? recommendedApr.toFixed(2) : '5'}
          step="0.01"
          type="number"
          bind:value={interestRatePct}
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          %
        </span>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <span class="text-xs text-muted-foreground font-medium">Duration</span>
      <div class="relative">
        <input
          class="{inputClass} pr-10"
          inputmode="numeric"
          min="1"
          oninput={handleDurationInput}
          placeholder="30"
          type="number"
          bind:value={durationDays}
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          days
        </span>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <span class="text-xs text-muted-foreground font-medium">Fund within</span>
      <div class="relative">
        <input
          class="{inputClass} pr-10"
          inputmode="numeric"
          min="1"
          oninput={handleFundWindowInput}
          placeholder="7"
          type="number"
          bind:value={fundWindowDays}
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          days
        </span>
      </div>
    </div>
  </div>
</div>
