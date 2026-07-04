<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import type { LoanFull } from '$lib/types';
  import { AlertCircle, Ban, CheckCircle2, Clock, XCircle } from '@lucide/svelte';

  type Props = {
    isRepaid: boolean;
    isOverdue: boolean;
    isPending: boolean;
    status: LoanFull['status'];
  };

  let { isRepaid, isOverdue, isPending, status }: Props = $props();
</script>

{#if isRepaid}
  <Badge class="text-primary border-primary/40 text-xs gap-1" variant="outline">
    <CheckCircle2 class="h-3 w-3" /> Repaid
  </Badge>
{:else if status === 'liquidated'}
  <Badge class="text-xs gap-1" variant="destructive">
    <Ban class="h-3 w-3" /> Liquidated
  </Badge>
{:else if status === 'defaulted'}
  <Badge class="text-xs gap-1" variant="destructive">
    <AlertCircle class="h-3 w-3" /> Defaulted
  </Badge>
{:else if status === 'cancelled'}
  <Badge class="text-muted-foreground text-xs gap-1" variant="outline">
    <XCircle class="h-3 w-3" /> Cancelled
  </Badge>
{:else if status === 'expired'}
  <Badge class="text-muted-foreground text-xs gap-1" variant="outline">
    <XCircle class="h-3 w-3" /> Expired
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
