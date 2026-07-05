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

  // Truncate (floor) healthFactor (1e18-scaled) to 2dp using bigint arithmetic.
  // Deliberately does NOT round up: 0.9996 must display as "0.99 · Liquidation Risk",
  // not "1.00 · Liquidation Risk" — rounding up at a threshold boundary would show
  // a healthy-looking number next to an unhealthy status.
  const formatHealthFactor = (hf: bigint): string => {
    const scale = 10n ** 16n; // 1e18 / 100 -> 2 decimal places
    const hundredths = hf / scale; // BigInt division truncates — no round-up bias
    const whole = hundredths / 100n;
    const frac = hundredths % 100n;
    return `${whole}.${frac.toString().padStart(2, '0')}`;
  };

  const formatted = $derived(healthFactor !== null ? formatHealthFactor(healthFactor) : null);
</script>

{#if loading}
  <div class="h-5 w-16 bg-muted animate-pulse rounded"></div>
{:else if status && formatted}
  <Badge
    class={status === 'Safe'
      ? 'border-green-500 text-green-600'
      : status === 'Warning'
        ? 'border-yellow-500 text-yellow-600'
        : 'border-destructive text-destructive'}
    variant="outline"
  >
    {formatted} · {status}
  </Badge>
{:else}
  <span class="text-muted-foreground text-xs">—</span>
{/if}
