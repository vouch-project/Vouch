<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';

  type Props = {
    healthFactor: bigint | null;
    loading?: boolean;
  };

  let { healthFactor, loading = false }: Props = $props();

  const ONE = 10n ** 18n;

  const status = $derived(
    healthFactor === null
      ? null
      : healthFactor >= (15n * ONE) / 10n
        ? 'Safe'
        : healthFactor >= ONE
          ? 'Warning'
          : 'Liquidation Risk',
  );

  const variant = $derived(
    status === 'Safe' ? 'default' : status === 'Warning' ? 'secondary' : 'destructive',
  );

  const formatted = $derived(healthFactor !== null ? (Number(healthFactor) / 1e18).toFixed(2) : null);
</script>

{#if loading}
  <div class="h-5 w-16 bg-muted animate-pulse rounded"></div>
{:else if status && formatted}
  <Badge
    variant="outline"
    class={
      status === 'Safe'
        ? 'border-green-500 text-green-600'
        : status === 'Warning'
          ? 'border-yellow-500 text-yellow-600'
          : 'border-destructive text-destructive'
    }
  >
    {formatted} · {status}
  </Badge>
{:else}
  <span class="text-muted-foreground text-xs">—</span>
{/if}
