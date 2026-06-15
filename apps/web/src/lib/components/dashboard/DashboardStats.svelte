<script lang="ts">
  type Props = {
    total: number;
    active: number;
    repaid: number;
    liquidated: number;
    loading: boolean;
  };

  let { total, active, repaid, liquidated, loading }: Props = $props();

  const stats = $derived([
    { label: 'Total loans', value: total },
    { label: 'Active', value: active },
    { label: 'Repaid', value: repaid },
    { label: 'Liquidated', value: liquidated },
  ]);
</script>

<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
  {#each stats as stat (stat.label)}
    <div class="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm px-4 py-3">
      <p class="text-xs text-muted-foreground">{stat.label}</p>
      <p class="text-2xl font-black mt-0.5">{loading ? '—' : stat.value}</p>
    </div>
  {/each}
</div>
