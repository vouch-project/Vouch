<script lang="ts">
  import CreateLendOffer from '$lib/components/ui/CreateLendOffer.svelte';
</script>

<svelte:head>
  <title>Lend | Vouch</title>
</svelte:head>

<div class="flex flex-col items-center py-6 px-4 space-y-8 animate-in fade-in duration-700">
  <div class="text-center space-y-4">
    <h1 class="text-5xl font-black tracking-tight text-foreground text-center">Lend</h1>
    <p class="text-xl text-muted-foreground font-medium max-w-lg mx-auto">
      Earn yield by providing liquidity to collateralized borrowers.
    </p>
  </div>

  <div class="w-full max-w-2xl mx-auto">
    <CreateLendOffer />
  </div>
</div>
