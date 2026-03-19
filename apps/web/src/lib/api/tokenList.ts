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
 * Fetches the token list from the backend API.
 * @returns An array of tokens with their details
 */
export const getTokenList = async () => (await axiosApi.get<Token[]>('/token-list')).data;
