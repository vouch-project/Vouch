<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import { Wallet } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
</script>

<svelte:head>
  <title>Lend | Vouch</title>
</svelte:head>

<div class="flex flex-col items-center py-6 px-4 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
  <div class="text-center space-y-4">
    <h1 class="text-5xl font-black tracking-tight text-foreground text-center">
      Lend
    </h1>
    <p class="text-xl text-muted-foreground font-medium max-w-lg mx-auto">
      Earn yield by providing liquidity to collateralized borrowers.
    </p>
  </div>

  <div class="w-full max-w-2xl mx-auto">
    <Card.Root class="bg-card/40 backdrop-blur-sm border-border/50 shadow-2xl shadow-primary/5 overflow-hidden">
      <div class="h-80 flex flex-col items-center justify-center space-y-6 text-center p-8">
        <div class="h-20 w-20 bg-primary/10 rounded-3xl flex items-center justify-center shadow-lg shadow-primary/5">
          <Wallet class="h-10 w-10 text-primary" />
        </div>
        <div>
          <h3 class="text-2xl font-black tracking-tight mb-2">Lending Coming Soon</h3>
          <p class="text-muted-foreground max-w-sm mx-auto font-medium">
            We're currently scaling our liquidity pools. Stay tuned to view and fulfill yield-bearing lend offers directly.
          </p>
        </div>
        <Button class="font-bold" size="lg" variant="secondary">Notify Me</Button>
      </div>
    </Card.Root>
  </div>
</div>
