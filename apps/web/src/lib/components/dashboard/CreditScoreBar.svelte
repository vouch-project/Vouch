<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { getRiskLevel, type CreditScore } from '$lib/loans/creditScore';
  import { cn } from '$lib/utils';
  import { Gauge } from '@lucide/svelte';

  type Props = {
    score: CreditScore | null;
    loading: boolean;
  };

  let { score, loading }: Props = $props();
</script>

{#if loading && !score}
  <div class="h-12 w-48 bg-muted animate-pulse rounded-xl"></div>
{:else if score}
  {@const risk = getRiskLevel(score.score)}
  <div class="flex items-center gap-3 text-sm">
    <Gauge class="h-5 w-5 text-primary shrink-0" />
    <span class="font-bold">Credit score</span>
    <span class="text-2xl font-black">{score.score}</span>
    <Badge class={cn('font-bold text-[10px]', risk.color)} variant="outline">{risk.label}</Badge>
    {#if score.explanation}
      <span class="text-muted-foreground truncate">· {score.explanation}</span>
    {/if}
  </div>
{/if}
