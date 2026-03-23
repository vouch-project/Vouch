import type { Token } from '../../api/chain';

class ChainInfo {
  contractAddress = $state<string>();
  tokens = $state<Token[]>([]);
}

export const chainInfo = new ChainInfo();
