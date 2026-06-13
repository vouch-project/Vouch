<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { RefreshCw } from '@lucide/svelte';

  type Props = {
    isConnected: boolean;
    realtimeActive: boolean;
    busy: boolean;
    onRefresh: () => void;
    onToggleRealtime: () => void;
  };

  let { isConnected, realtimeActive, busy, onRefresh, onToggleRealtime }: Props = $props();
</script>

<div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
  <div class="space-y-2">
    <h1
      class="text-4xl font-extrabold tracking-tight lg:text-5xl bg-linear-to-r from-gray-900 via-gray-700 to-gray-500 dark:from-white dark:via-gray-200 dark:to-gray-400 bg-clip-text text-transparent"
    >
      Dashboard
    </h1>
    <p class="text-xl text-muted-foreground font-medium">Manage your active loans and track repayments.</p>
  </div>

  {#if isConnected}
    <div class="flex items-center gap-3">
      <Button
        class="bg-background/50 backdrop-blur-sm"
        disabled={realtimeActive || busy}
        onclick={onRefresh}
        size="sm"
        variant="outline"
      >
        <RefreshCw class={cn('mr-2 h-4 w-4', busy && 'animate-spin')} />
        Refresh
      </Button>

      <Button
        class={cn(
          'backdrop-blur-sm w-[130px]',
          realtimeActive && 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
        )}
        onclick={onToggleRealtime}
        size="sm"
        variant={realtimeActive ? 'secondary' : 'outline'}
      >
        <div class="mr-2 flex h-2 w-2 items-center justify-center">
          {#if realtimeActive}
            <span class="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-green-400 opacity-75"></span>
          {/if}
          <span
            class={cn('relative inline-flex h-2 w-2 rounded-full', realtimeActive ? 'bg-green-500' : 'bg-gray-400')}
          >
          </span>
        </div>
        {realtimeActive ? 'Live Updates' : 'Realtime Off'}
      </Button>
    </div>
  {/if}
</div>
