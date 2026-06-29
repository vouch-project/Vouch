<script lang="ts">
  let {
    currentLtv,
    computedMaxLtv,
    ltvExceeded,
    creditScore,
  }: {
    currentLtv: number;
    computedMaxLtv: number;
    ltvExceeded: boolean;
    creditScore: number | null;
  } = $props();
</script>

<div
  class="w-full rounded-lg border px-4 py-3 space-y-2 {ltvExceeded
    ? 'border-destructive/50 bg-destructive/5'
    : 'border-border/60 bg-muted/20'}"
>
  <div class="flex justify-between text-xs font-semibold {ltvExceeded ? 'text-destructive' : 'text-muted-foreground'}">
    <span>Loan-to-Value (LTV)</span>
    <span>Max: {computedMaxLtv.toFixed(1)}%{creditScore !== null ? ` (score ${creditScore})` : ''}</span>
  </div>

  <div class="relative w-full h-2 bg-muted rounded-full overflow-hidden">
    <div
      style:left="{(computedMaxLtv / (computedMaxLtv + 5)) * 100}%"
      class="absolute top-0 h-full w-0.5 bg-muted-foreground/40 z-10"
    ></div>
    <div
      style:width="{currentLtv > 0 ? Math.min((currentLtv / (computedMaxLtv + 5)) * 100, 100) : 0}%"
      class="h-full rounded-full transition-all duration-300 {ltvExceeded ? 'bg-destructive' : 'bg-primary'}"
    ></div>
  </div>

  <div class="flex justify-between items-center">
    <span class="text-sm font-bold {ltvExceeded ? 'text-destructive' : 'text-foreground'}">
      {currentLtv > 0 ? `${currentLtv.toFixed(1)}%` : '—'}
    </span>
    {#if ltvExceeded}
      <span class="text-xs font-semibold text-destructive">Exceeds max LTV ↑</span>
    {:else if currentLtv > 0}
      <span class="text-xs text-muted-foreground">{(computedMaxLtv - currentLtv).toFixed(1)}% remaining</span>
    {/if}
  </div>
</div>
