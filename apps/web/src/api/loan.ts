import { axiosApi } from './axios';

type CreateLoanPayload = {
  chainId: number;
  collateralTokenId: string; // UUID of the token from the token list
  collateralAmount: number;
  collateralTxHash: string;
  collateralBlockNumber: number;
  collateralBlockHash: string;
  collateralLockedAt: string;
};

/**
 * Sends a signed request to the /loan API endpoint.
 * @param body The loan creation payload (object with your business fields)
 * @returns The API response JSON
 */
export const createLoanApiRequest = (body: CreateLoanPayload) => axiosApi.post('/loan', body);

/**
 * Sends a request to delete a loan by ID.
 * @param loanId The ID of the loan to delete
 * @returns The API response JSON
 */
export const deleteLoan = async (loanId: string) => axiosApi.delete(`/loan/${loanId}`);
