<script lang="ts">
  import CreateLoan from '$lib/components/ui/CreateLoan.svelte';
  import * as Card from '$lib/components/ui/card';
</script>

<svelte:head>
  <title>Borrow | Vouch</title>
</svelte:head>

<div class="flex flex-col items-center py-12 px-4 space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
  <div class="text-center space-y-4">
    <h1 class="text-5xl font-black tracking-tight text-foreground">Borrow</h1>
    <p class="text-xl text-muted-foreground font-medium max-w-lg">
      Establish a loan by locking collateral on-chain. Simple, instant, and secure.
    </p>
  </div>

  <div class="w-full max-w-2xl">
    <Card.Root class="bg-card/40 backdrop-blur-md border-border/50 shadow-2xl shadow-primary/5 overflow-hidden">
      <Card.Header class="text-center pb-2">
        <Card.Title class="text-2xl font-bold">Create a Loan Request</Card.Title>
        <Card.Description class="text-base text-muted-foreground">
          Define your loan parameters and lock collateral to get started.
        </Card.Description>
      </Card.Header>
      <Card.Content class="p-8 pt-6">
        <CreateLoan />
      </Card.Content>
    </Card.Root>
  </div>
</div>
