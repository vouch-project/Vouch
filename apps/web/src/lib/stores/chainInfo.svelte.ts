import type { Token } from '../../api/chain';

class ChainInfo {
  contractAddress = $state<string | undefined>();
  tokens = $state<Token[]>([]);
}

export const chainInfo = new ChainInfo();
