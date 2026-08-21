<script lang="ts">
  let {
    total,
    interest,
    tokenSymbol,
    empty = false,
  }: {
    total: number;
    interest: number;
    tokenSymbol: string;
    empty?: boolean;
  } = $props();
</script>

<div class="flex justify-between items-center px-4 py-3 rounded-lg border border-border/60 bg-muted/20 text-sm">
  <span class="text-muted-foreground">Total repayment</span>
  <div class="text-right">
    {#if empty}
      <span class="text-muted-foreground/40 text-xs">—</span>
    {:else}
      <span class="font-bold text-foreground">
        {total.toLocaleString(undefined, { maximumFractionDigits: 6 })}
        {tokenSymbol}
      </span>
      <span class="text-xs text-muted-foreground ml-1.5">
        (+{interest.toLocaleString(undefined, { maximumFractionDigits: 6 })} interest)
      </span>
    {/if}
  </div>
</div>
