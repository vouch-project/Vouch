<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { ethers } from 'ethers';

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

  // healthFactor is a raw 1e18-scaled uint256; divide via formatUnits (exact decimal
  // string math) rather than Number(healthFactor) / 1e18, which converts to a lossy
  // float before dividing and can misrepresent values above Number.MAX_SAFE_INTEGER.
  const formatted = $derived(
    healthFactor !== null ? Number(ethers.formatUnits(healthFactor, 18)).toFixed(2) : null,
  );
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
