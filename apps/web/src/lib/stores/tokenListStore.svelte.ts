import type { Token } from '$lib/api/tokenList';

class TokenListStore {
  tokens = $state<Token[]>([]);
}

export const tokenListStore = new TokenListStore();
