import type { Token } from '../../api/chain';

class ChainInfo {
  contractAddress = $state<string | undefined>();
  tokens = $state<Token[]>([]);
  // Protocol fee taken from the interest portion of repayments, in basis points
  // (1000 = 10%). Defaults to the contract's default until the live value is read.
  protocolFeeBps = $state<number>(1000);
}

export const chainInfo = new ChainInfo();
