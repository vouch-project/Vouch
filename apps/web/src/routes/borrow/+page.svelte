<script lang="ts">
  import CreateLoan from '$lib/components/ui/CreateLoan.svelte';
</script>

<div class="min-h-[80vh] bg-gradient-to-br from-gray-50 to-gray-200 py-12 px-4 flex flex-col items-center">
  <div class="w-full max-w-2xl">
    <h1 class="text-3xl font-bold mb-8 text-center text-gray-800 drop-shadow">Borrow</h1>
    <div class="grid grid-cols-1 gap-8">
      <div class="bg-white rounded-2xl shadow-lg p-8 flex flex-col items-center">
        <h2 class="text-xl font-semibold mb-4 text-gray-700">Create a Loan</h2>
        <CreateLoan />
      </div>
    </div>
  </div>
</div>
