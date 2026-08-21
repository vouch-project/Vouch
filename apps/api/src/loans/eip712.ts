import { ethers } from 'ethers';

export const buildDomain = (chainId: bigint, verifyingContract: string) => ({
  name: 'Vouch',
  version: '1',
  chainId,
  verifyingContract,
});

export const LOAN_REQUEST_TYPES = {
  LoanRequest: [
    { name: 'borrower', type: 'address' },
    { name: 'collateralToken', type: 'address' },
    { name: 'collateralAmount', type: 'uint256' },
    { name: 'principalToken', type: 'address' },
    { name: 'principalAmount', type: 'uint256' },
    { name: 'interestRateBps', type: 'uint16' },
    { name: 'durationSeconds', type: 'uint256' },
    { name: 'maxLtvBps', type: 'uint16' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const LEND_OFFER_TYPES = {
  LendOffer: [
    { name: 'lender', type: 'address' },
    { name: 'principalToken', type: 'address' },
    { name: 'principalAmount', type: 'uint256' },
    { name: 'collateralToken', type: 'address' },
    { name: 'collateralRatioBps', type: 'uint16' },
    { name: 'trustedRatioBps', type: 'uint16' },
    { name: 'scoreThreshold', type: 'uint16' },
    { name: 'maxLtvBps', type: 'uint16' },
    { name: 'interestRateBps', type: 'uint16' },
    { name: 'durationSeconds', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

type Domain = ReturnType<typeof buildDomain>;

const verify = (
  types: Record<string, unknown>,
  value: Record<string, unknown>,
  signature: string,
  domain: Domain,
  expectedSignerField: string,
): { valid: boolean; signer: string; digest: string } => {
  const digest = ethers.TypedDataEncoder.hash(domain, types as never, value);
  let signer = '';
  try {
    signer = ethers.verifyTypedData(domain, types as never, value, signature);
  } catch {
    signer = '';
  }
  const valid =
    !!signer &&
    signer.toLowerCase() === String(value[expectedSignerField]).toLowerCase();
  return { valid, signer, digest };
};

export const verifyLoanRequest = (
  value: Record<string, unknown>,
  signature: string,
  domain: Domain,
) => verify(LOAN_REQUEST_TYPES as never, value, signature, domain, 'borrower');

export const verifyLendOffer = (
  value: Record<string, unknown>,
  signature: string,
  domain: Domain,
) => verify(LEND_OFFER_TYPES as never, value, signature, domain, 'lender');
