import { axiosApi } from './axiosApi';

export type LtvAttestation = {
  maxLtvBps: number;
  expiry: number;
  sig: string;
};

export const getLtvAttestation = async (
  address: string,
  collateralToken: string,
  borrowToken: string,
  contractAddress: string,
  chainId: number,
): Promise<LtvAttestation> =>
  (
    await axiosApi.get<LtvAttestation>(`/scoring/${address}/ltv-attestation`, {
      params: { collateralToken, borrowToken, contractAddress, chainId },
    })
  ).data;
