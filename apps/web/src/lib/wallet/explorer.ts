/**
 * Block explorer base URLs keyed by chain (network) ID. Falls back to mainnet
 * Etherscan when the active network is unknown.
 */
const EXPLORER_BASE: Record<number, string> = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  137: 'https://polygonscan.com',
  42161: 'https://arbiscan.io',
};

const DEFAULT_EXPLORER = 'https://etherscan.io';

/** Returns the block explorer transaction URL for the given network. */
export const txExplorerUrl = (networkId: number | undefined, txHash: string): string => {
  const base = (networkId && EXPLORER_BASE[networkId]) || DEFAULT_EXPLORER;
  return `${base}/tx/${txHash}`;
};
