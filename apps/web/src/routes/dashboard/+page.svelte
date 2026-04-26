<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import { LayoutDashboard } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
</script>

<svelte:head>
  <title>Dashboard | Vouch</title>
</svelte:head>

<div class="flex flex-col items-center py-6 px-4 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
  <div class="text-center space-y-4">
    <h1 class="text-5xl font-black tracking-tight text-foreground text-center">
      Dashboard
    </h1>
    <p class="text-xl text-muted-foreground font-medium max-w-lg mx-auto">
      Manage your active loans, collateral, and rewards in one central hub.
    </p>
  </div>

  <div class="w-full max-w-2xl mx-auto">
    <Card.Root class="bg-card/40 backdrop-blur-sm border-border/50 shadow-2xl shadow-primary/5 overflow-hidden">
      <div class="h-80 flex flex-col items-center justify-center space-y-6 text-center p-8">
        <div class="h-20 w-20 bg-primary/10 rounded-3xl flex items-center justify-center shadow-lg shadow-primary/5">
          <LayoutDashboard class="h-10 w-10 text-primary" />
        </div>
        <div>
          <h3 class="text-2xl font-black tracking-tight mb-2">Dashboard Coming Soon</h3>
          <p class="text-muted-foreground max-w-sm mx-auto font-medium">
            We're building a comprehensive dashboard for tracking your on-chain financial health and loan statuses.
          </p>
        </div>
        <Button class="font-bold" size="lg" variant="secondary">Join Waitlist</Button>
      </div>
    </Card.Root>
  </div>
</div>
