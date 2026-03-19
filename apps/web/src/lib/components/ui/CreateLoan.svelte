<script lang="ts">
  import { Token } from '$lib/api/tokenList';
  import { tokenListStore } from '$lib/stores/tokenListStore.svelte';
  import { createLoan } from '$lib/wallet/vouchVault';

  let optionRefs: HTMLElement[] = $state([]);
  let focusedIndex = $state(-1);

  $effect(() => {
    if (focusedIndex >= 0 && optionRefs[focusedIndex]) {
      optionRefs[focusedIndex].scrollIntoView({ block: 'nearest' });
    }
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (!showDropdown || filteredTokens.length === 0) return;

    if (event.key === 'ArrowDown') {
      focusedIndex = (focusedIndex + 1) % filteredTokens.length;
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      focusedIndex = (focusedIndex - 1 + filteredTokens.length) % filteredTokens.length;
      event.preventDefault();
    } else if (event.key === 'Enter' && focusedIndex >= 0) {
      selectToken(filteredTokens[focusedIndex].symbol);
      event.preventDefault();
    }
  };

  let collateral = $state(1.0); // Amount
  let status = $state('');
  let selectedToken = $state('ETH');
  let showDropdown = $state(false);

  // Filter tokens by symbol (case-insensitive, unique symbols only)
  const filteredTokens = $derived.by(() => {
    const input = selectedToken.trim().toLowerCase();
    if (input === '') return [];

    const exact = [];
    const startsWith = [];
    const includes = [];
    const nameIncludes = [];

    for (const t of tokenListStore.tokens) {
      const symbol = t.symbol.toLowerCase();
      const name = t.name?.toLowerCase() ?? '';

      if (symbol === input) exact.push(t);
      else if (symbol.startsWith(input)) startsWith.push(t);
      else if (symbol.includes(input)) includes.push(t);
      else if (name.includes(input)) nameIncludes.push(t);
    }

    // Sort each group alphabetically by symbol
    const sortBySymbol = (a: Token, b: Token) => a.symbol.localeCompare(b.symbol);
    exact.sort(sortBySymbol);
    startsWith.sort(sortBySymbol);
    includes.sort(sortBySymbol);
    nameIncludes.sort(sortBySymbol);

    return [...exact, ...startsWith, ...includes, ...nameIncludes].slice(0, 20);
  });

  const selectToken = (symbol: string) => {
    selectedToken = symbol;
    showDropdown = false;
  };

  const handleCreateLoan = async () => {
    status = 'Waiting for wallet confirmation...';
    const token = tokenListStore.tokens.find((t) => t.symbol === selectedToken);
    if (!token) {
      status = 'Selected token not found';
      return;
    }

    try {
      await createLoan(collateral, token);
      status = 'Loan created!';
    } catch (e) {
      status = e instanceof Error ? e.message : 'Transaction failed';
    }
  };
</script>

<form class="flex flex-col items-center gap-4 w-full max-w-sm" onsubmit={handleCreateLoan}>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Collateral Token:</span>
    <div class="relative w-full">
      <input
        type="text"
        bind:value={selectedToken}
        class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
        placeholder="Type to search token symbol..."
        oninput={() => {
          showDropdown = true;
          focusedIndex = -1;
        }}
        onfocus={() => {
          showDropdown = true;
        }}
        onblur={() =>
          setTimeout(() => {
            showDropdown = false;
            focusedIndex = -1;
          }, 100)}
        onkeydown={handleKeydown}
        autocomplete="off"
      />
      {#if showDropdown && filteredTokens.length > 0}
        <ul
          class="absolute z-10 w-full bg-white border border-gray-200 rounded-lg mt-1 max-h-48 overflow-auto shadow-lg"
        >
          {#each filteredTokens as token, i (`${token.chainId}:${token.address}`)}
            <li>
              <button
                type="button"
                class="w-full text-left px-4 py-2 cursor-pointer flex items-center {focusedIndex === i
                  ? 'bg-blue-100'
                  : ''}"
                onmousedown={() => selectToken(token.symbol)}
                tabindex="-1"
                bind:this={optionRefs[i]}
              >
                <span class="font-mono">{token.symbol}</span>
                <span class="ml-2 text-xs text-gray-500">{token.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </label>
  <label class="w-full text-gray-600 font-medium flex flex-col gap-2">
    <span>Collateral to Deposit ({selectedToken}):</span>
    <input
      min="0"
      step="0.01"
      type="number"
      bind:value={collateral}
      class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
    />
  </label>
  <button
    type="submit"
    class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg shadow transition disabled:opacity-60 disabled:cursor-not-allowed"
    disabled={status === 'Waiting for wallet confirmation...'}
  >
    {status === 'Waiting for wallet confirmation...' ? 'Processing...' : 'Create Loan'}
  </button>
  {#if status}
    <p class="text-sm mt-2 text-gray-500 text-center">{status}</p>
  {/if}
</form>
