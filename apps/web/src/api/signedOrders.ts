import { axiosApi } from './axiosApi';

// ---------------------------------------------------------------------------
// Request payloads — field names mirror the API DTOs. The API has no global
// transform pipe, so bigints/uint256 must be sent as strings and the numeric
// term fields (bps, durationSeconds, deadline) as JSON numbers.
// ---------------------------------------------------------------------------

export type SignedRequestPayload = {
  borrowerAddress: string;
  collateralTokenAddress: string;
  collateralAmount: string; // uint256
  principalTokenAddress: string;
  principalAmount: string; // uint256
  interestRateBps: number;
  durationSeconds: number;
  maxLtvBps: number;
  nonce: string; // uint256
  deadline: number; // unix seconds
  signature: string;
  networkId: string;
  contractAddress: string;
};

export type SignedOfferPayload = {
  lenderAddress: string;
  principalTokenAddress: string;
  principalAmount: string; // uint256
  collateralRatioBps: number;
  trustedRatioBps: number;
  scoreThreshold: number;
  maxLtvBps: number;
  interestRateBps: number;
  durationSeconds: number;
  nonce: string; // uint256
  deadline: number; // unix seconds
  signature: string;
  networkId: string;
  contractAddress: string;
};

// ---------------------------------------------------------------------------
// Response rows — shape of the `signed_loan_requests` / `signed_lend_offers`
// rows returned by the list endpoints (open, non-expired orders).
// ---------------------------------------------------------------------------

export type SignedRequestRow = {
  id: string;
  digest: string;
  chainId: string;
  borrowerAddress: string;
  collateralTokenId: string;
  collateralAmount: string;
  principalTokenId: string;
  principalAmount: string;
  interestRateBps: number;
  duration: string; // Postgres interval
  maxLtvBps: number;
  nonce: string;
  deadline: string; // ISO timestamp
  signature: string;
  status: string;
  filledLoanId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SignedOfferRow = {
  id: string;
  digest: string;
  chainId: string;
  lenderAddress: string;
  principalTokenId: string;
  principalAmount: string;
  collateralTokenId: string | null; // null → ETH collateral
  collateralRatioBps: number;
  trustedRatioBps: number;
  scoreThreshold: number;
  maxLtvBps: number;
  interestRateBps: number;
  duration: string; // Postgres interval
  nonce: string;
  deadline: string; // ISO timestamp
  signature: string;
  status: string;
  filledLoanId: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const postSignedRequest = async (body: SignedRequestPayload): Promise<{ digest: string }> =>
  (await axiosApi.post<{ digest: string }>('/loans/signed-requests', body)).data;

export const postSignedOffer = async (body: SignedOfferPayload): Promise<{ digest: string }> =>
  (await axiosApi.post<{ digest: string }>('/loans/signed-offers', body)).data;

export const getSignedRequests = async (signal?: AbortSignal): Promise<SignedRequestRow[]> =>
  (await axiosApi.get<SignedRequestRow[]>('/loans/signed-requests', { signal })).data;

export const getSignedOffers = async (signal?: AbortSignal): Promise<SignedOfferRow[]> =>
  (await axiosApi.get<SignedOfferRow[]>('/loans/signed-offers', { signal })).data;
