<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import CreateLoan from '$lib/components/ui/CreateLoan.svelte';
  import { HandCoins } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Borrow | Vouch</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4 animate-in fade-in duration-700">
  <div class="w-full max-w-2xl mx-auto">
    <Card.Root class="bg-card/40 backdrop-blur-sm border-border/50 shadow-2xl shadow-primary/5">
      <Card.Header>
        <Card.Title class="text-2xl font-black tracking-tight flex items-center gap-2">
          <HandCoins class="h-6 w-6 text-primary" />
          Create Loan Request
        </Card.Title>
        <Card.Description class="text-muted-foreground">
          Lock collateral on-chain. A lender funds your request to activate the loan.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <CreateLoan />
      </Card.Content>
    </Card.Root>
  </div>
</div>
