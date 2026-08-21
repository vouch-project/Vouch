<script lang="ts">
  import CreateLendOffer from '$lib/components/ui/CreateLendOffer.svelte';
</script>

<svelte:head>
  <title>Lend | Vouch</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4 animate-in fade-in duration-700">
  <div class="w-full max-w-2xl mx-auto">
    <CreateLendOffer />
  </div>
</div>
