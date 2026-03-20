import { axiosApi } from './axios';

export type Token = {
  id: string; // UUID
  chainId: number;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number | null;
  logoURI: string | null;
};

/**
 * Fetches the token list from the backend API for a specific chain ID.
 * @param chainId The ID of the blockchain network
 * @returns An array of tokens with their details
 */
export const getTokenList = async (chainId: number) =>
  (await axiosApi.get<Token[]>('/token-list', { params: { chainId } })).data;
