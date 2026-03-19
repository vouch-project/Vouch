import { ethers } from 'ethers';
import { SUPPORTED_CHAIN_IDS } from './appkit';

/**
 * Resolves an ENS name to an address, but only on networks that support ENS.
 * Throws an error if ENS is not supported on the current network.
 * @param nameOrAddress ENS name or direct address
 * @param provider ethers.js provider
 */
export const safeResolveAddress = async (nameOrAddress: string, provider: ethers.BrowserProvider): Promise<string> => {
  // If it's already an address, return as is
  if (ethers.isAddress(nameOrAddress)) return nameOrAddress;

  // Only allow ENS resolution on mainnet or testnets that support ENS
  const network = await provider.getNetwork();
  if (!SUPPORTED_CHAIN_IDS.includes(BigInt(network.chainId)))
    throw new Error('ENS names are not supported on this network. Please use a direct Ethereum address.');

  const resolved = await provider.resolveName(nameOrAddress);
  if (!resolved) throw new Error('ENS name could not be resolved.');
  return resolved;
};
