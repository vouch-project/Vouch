import type { UUID } from '$lib/types';
import { axiosApi } from './axiosApi';

export type Token = {
  id: UUID;
  chainId: string;
  address: string;
  symbol: string;
  decimals: number;
  name: string | null;
  logoURI: string | null;
};

export type ChainInfo = {
  contractAddress: string;
  tokens: Token[];
};

/**
 * Fetches the contract address and token list from the backend API for a specific network ID.
 * @param networkId The ID of the blockchain network
 * @returns A ChainInfo object containing the contract address and token list
 */
export const getChainInfo = async (networkId: number, signal?: AbortSignal) =>
  (await axiosApi.get<ChainInfo>('/chains', { params: { networkId }, signal })).data;
