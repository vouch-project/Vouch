<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { AlertCircle, CheckCircle2, Clock } from '@lucide/svelte';

  type Props = {
    isRepaid: boolean;
    isOverdue: boolean;
    isPending: boolean;
  };

  let { isRepaid, isOverdue, isPending }: Props = $props();
</script>

{#if isRepaid}
  <Badge class="text-primary border-primary/40 text-xs gap-1" variant="outline">
    <CheckCircle2 class="h-3 w-3" /> Repaid
  </Badge>
{:else if isOverdue}
  <Badge class="text-xs gap-1" variant="destructive">
    <AlertCircle class="h-3 w-3" /> Overdue
  </Badge>
{:else if isPending}
  <Badge class="text-xs gap-1" variant="secondary">
    <Clock class="h-3 w-3" /> Pending
  </Badge>
{:else}
  <Badge class="text-xs gap-1" variant="secondary">
    <Clock class="h-3 w-3" /> Active
  </Badge>
{/if}
