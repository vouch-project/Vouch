import type { Token } from '../../api/tokenList';

class TokenListStore {
  tokens = $state<Token[]>([]);
}

export const tokenListStore = new TokenListStore();
