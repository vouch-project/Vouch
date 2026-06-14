import { axiosApi } from '$api/axiosApi';

export type CreditScore = {
  score: number;
  confidence: number;
  factors: string[];
  explanation: string | null;
};

export type RiskLevel = {
  label: string;
  color: string;
};

export const getRiskLevel = (score: number): RiskLevel => {
  if (score > 800) return { label: 'Low risk', color: 'text-green-600 border-green-200 bg-green-50' };
  if (score > 720) return { label: 'Medium risk', color: 'text-blue-600 border-blue-200 bg-blue-50' };
  return { label: 'High risk', color: 'text-orange-600 border-orange-200 bg-orange-50' };
};

/** Fetch the credit score for an address, returning null on any failure. */
export const fetchCreditScore = async (address: string): Promise<CreditScore | null> => {
  try {
    const { data } = await axiosApi.get<CreditScore>(`/scoring/${encodeURIComponent(address)}`);
    return data;
  } catch {
    return null;
  }
};
