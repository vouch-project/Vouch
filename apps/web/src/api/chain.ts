import type { UUID } from '../types';
import { axiosApi } from './axiosApi';

export type Token = {
  id: UUID;
  chainId: string;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number | null;
  logoURI: string | null;
};

export type ChainInfo = {
  contractAddress: string;
  tokens: Token[];
};

/**
 * Fetches the token list from the backend API for a specific network ID.
 * @param networkId The ID of the blockchain network
 * @returns An array of tokens with their details
 */
export const getChainInfo = async (networkId: number) =>
  (await axiosApi.get<ChainInfo>('/chains', { params: { networkId } })).data;
