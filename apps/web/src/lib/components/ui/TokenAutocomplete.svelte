<script lang="ts">
  import type { Token } from '../../../api/chain';

  interface Props {
    tokens: Token[];
    value: string;
    placeholder?: string;
  }

  let { tokens, value = $bindable(), placeholder = 'Type to search token symbol...' }: Props = $props();

  const optionRefs: HTMLElement[] = $state([]);
  let focusedIndex = $state(-1);
  let showDropdown = $state(false);

  $effect(() => {
    if (focusedIndex >= 0 && optionRefs[focusedIndex]) {
      optionRefs[focusedIndex].scrollIntoView({ block: 'nearest' });
    }
  });

  const filteredTokens = $derived.by(() => {
    const input = value.trim().toLowerCase();
    if (input === '') return [];

    const exact: Token[] = [];
    const startsWith: Token[] = [];
    const includes: Token[] = [];
    const nameIncludes: Token[] = [];

    for (const t of tokens) {
      const symbol = t.symbol.toLowerCase();
      const name = t.name?.toLowerCase() ?? '';

      if (symbol === input) exact.push(t);
      else if (symbol.startsWith(input)) startsWith.push(t);
      else if (symbol.includes(input)) includes.push(t);
      else if (name.includes(input)) nameIncludes.push(t);
    }

    const sortBySymbol = (a: Token, b: Token) => a.symbol.localeCompare(b.symbol);
    exact.sort(sortBySymbol);
    startsWith.sort(sortBySymbol);
    includes.sort(sortBySymbol);
    nameIncludes.sort(sortBySymbol);

    return [...exact, ...startsWith, ...includes, ...nameIncludes].slice(0, 20);
  });

  const selectToken = (symbol: string) => {
    value = symbol;
    showDropdown = false;
    focusedIndex = -1;
  };

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
</script>

<div class="relative w-full">
  <input
    class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 transition w-full bg-gray-50"
    autocomplete="off"
    onblur={() =>
      setTimeout(() => {
        showDropdown = false;
        focusedIndex = -1;
      }, 100)}
    onfocus={() => {
      showDropdown = true;
    }}
    oninput={() => {
      showDropdown = true;
      focusedIndex = -1;
    }}
    onkeydown={handleKeydown}
    {placeholder}
    type="text"
    bind:value
  />
  {#if showDropdown && filteredTokens.length > 0}
    <ul class="absolute z-10 w-full bg-white border border-gray-200 rounded-lg mt-1 max-h-48 overflow-auto shadow-lg">
      {#each filteredTokens as token, i (`${token.chainId}:${token.address}`)}
        <li>
          <button
            bind:this={optionRefs[i]}
            class="w-full text-left px-4 py-2 cursor-pointer flex items-center"
            class:bg-blue-100={focusedIndex === i}
            onmousedown={() => selectToken(token.symbol)}
            tabindex="-1"
            type="button"
          >
            <span class="font-mono">{token.symbol}</span>
            <span class="ml-2 text-xs text-gray-500">{token.name}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
