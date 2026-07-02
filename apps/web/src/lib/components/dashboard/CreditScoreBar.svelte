<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { getRiskLevel, type CreditScore } from '$lib/loans/creditScore';
  import { cn } from '$lib/utils';
  import { ChevronDown, Gauge } from '@lucide/svelte';

  type Props = {
    score: CreditScore | null;
    loading: boolean;
  };

  let { score, loading }: Props = $props();

  let expanded = $state(false);
  const hasDetails = $derived(
    !!score && (score.riskFactors.length > 0 || score.strengths.length > 0 || !!score.explanation),
  );
</script>

{#if score}
  {@const risk = getRiskLevel(score.score)}
  <div class="space-y-3">
    <div class="flex items-center gap-3 text-sm">
      <Gauge class="h-5 w-5 text-primary shrink-0" />
      <span class="font-bold">Credit score</span>
      <span class="text-2xl font-black">{score.score}</span>
      <Badge class={cn('font-bold text-[10px]', risk.color)} variant="outline">{risk.label}</Badge>
      {#if hasDetails}
        <button
          class="ml-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          aria-controls="credit-score-details"
          aria-expanded={expanded}
          onclick={() => (expanded = !expanded)}
          type="button"
        >
          <ChevronDown class={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
          {expanded ? 'Hide' : 'Details'}
        </button>
      {/if}
    </div>

    {#if expanded}
      <div id="credit-score-details" class="pl-8 space-y-3">
        {#if score.riskFactors.length > 0}
          <div class="space-y-1.5">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Risk factors</p>
            <div class="flex flex-wrap gap-1.5">
              {#each score.riskFactors as r (r)}
                <Badge
                  class="text-[10px] font-medium text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-900 dark:bg-orange-950/40"
                  variant="outline"
                >
                  {r}
                </Badge>
              {/each}
            </div>
          </div>
        {/if}
        {#if score.strengths.length > 0}
          <div class="space-y-1.5">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Strengths</p>
            <div class="flex flex-wrap gap-1.5">
              {#each score.strengths as s (s)}
                <Badge
                  class="text-[10px] font-medium text-green-700 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-900 dark:bg-green-950/40"
                  variant="outline"
                >
                  {s}
                </Badge>
              {/each}
            </div>
          </div>
        {/if}
        {#if score.explanation}
          <p class="text-[11px] text-muted-foreground">💡 {score.explanation}</p>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="flex items-center gap-3 text-sm" aria-busy={loading}>
    <Gauge class="h-5 w-5 text-muted-foreground shrink-0" />
    <span class="font-bold text-muted-foreground">Credit score</span>
    <div class="h-7 w-12 bg-muted animate-pulse rounded-md"></div>
    <div class="h-4 w-16 bg-muted animate-pulse rounded-md"></div>
  </div>
{/if}
