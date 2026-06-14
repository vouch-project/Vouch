<script lang="ts">
  import { tableColumns } from '$lib/components/dashboard/columns';
  import LoanRepayRow from '$lib/components/ui/LoanRepayRow.svelte';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import type { LoanFull } from '$lib/types';
  import { cn } from '$lib/utils';
  import { LayoutDashboard } from '@lucide/svelte';

  type Props = {
    loans: LoanFull[];
    loading: boolean;
    filter: 'active' | 'repaid' | 'all';
    onRepaid: () => void;
  };

  let { loans, loading, filter, onRepaid }: Props = $props();
</script>

<Card.Root class="border-border/50 overflow-hidden bg-card/60 backdrop-blur-sm">
  <div class="overflow-x-auto">
    <Table.Root class="table-fixed">
      <Table.Header class="bg-muted/30">
        <Table.Row>
          {#each tableColumns as col (col.label)}
            <Table.Head
              class={cn(
                col.width,
                'py-3 text-xs uppercase tracking-wider font-bold',
                col.align === 'left' && 'text-left pl-4 sm:pl-6',
                col.align === 'center' && 'text-center px-2 sm:px-4',
                col.align === 'right' && 'text-right pr-4 sm:pr-6',
              )}
            >
              {col.label}
            </Table.Head>
          {/each}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if loading}
          {#each [1, 2, 3] as key (key)}
            <Table.Row>
              {#each Array(tableColumns.length) as _, j (j)}
                <Table.Cell
                  class={cn(
                    'px-2 sm:px-4 py-4',
                    j === 0 && 'pl-4 sm:pl-6',
                    j === tableColumns.length - 1 && 'pr-4 sm:pr-6',
                  )}
                >
                  <div class="h-4 w-16 bg-muted animate-pulse rounded"></div>
                </Table.Cell>
              {/each}
            </Table.Row>
          {/each}
        {:else if loans.length === 0}
          <Table.Row>
            <Table.Cell class="h-56 text-center" colspan={tableColumns.length}>
              <div class="flex flex-col items-center justify-center space-y-3">
                <div class="h-14 w-14 bg-muted rounded-2xl flex items-center justify-center">
                  <LayoutDashboard class="h-7 w-7 text-muted-foreground" />
                </div>
                <p class="font-semibold">
                  {filter === 'active'
                    ? 'No active loans'
                    : filter === 'repaid'
                      ? 'No repaid loans yet'
                      : 'No loans found'}
                </p>
                <p class="text-sm text-muted-foreground max-w-xs">
                  {filter === 'active'
                    ? 'Head to the Borrow page to create a new loan.'
                    : 'Your completed loans will appear here.'}
                </p>
              </div>
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each loans as loan (loan.id)}
            <LoanRepayRow {loan} {onRepaid} />
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
</Card.Root>
