import type { VouchVault } from '@vouch/contracts';
import { ethers } from 'ethers';
import { getVouchVaultContract, isNativeTokenAddress, ERC20_ABI } from './vouchVault';

// ---------------------------------------------------------------------------
// EIP-712 domain meta (chain-id + contract address added at runtime)
// ---------------------------------------------------------------------------

export const EIP712_DOMAIN_META = { name: 'Vouch', version: '1' } as const;

// ---------------------------------------------------------------------------
// Typed-data type arrays — MUST match the contract typehashes and eip712.ts
// (copied verbatim from apps/api/src/loans/eip712.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TypeScript types matching the contract structs
// ---------------------------------------------------------------------------

export type SignedLoanRequest = {
  borrower: string;
  collateralToken: string;
  collateralAmount: bigint;
  principalToken: string;
  principalAmount: bigint;
  interestRateBps: number;
  durationSeconds: bigint;
  maxLtvBps: number;
  nonce: bigint;
  deadline: bigint;
};

export type SignedLendOffer = {
  lender: string;
  principalToken: string;
  principalAmount: bigint;
  collateralToken: string;
  collateralRatioBps: number;
  trustedRatioBps: number;
  scoreThreshold: number;
  maxLtvBps: number;
  interestRateBps: number;
  durationSeconds: bigint;
  nonce: bigint;
  deadline: bigint;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const buildDomain = async (contract: VouchVault) => {
  const network = await contract.runner!.provider!.getNetwork();
  return {
    ...EIP712_DOMAIN_META,
    chainId: network.chainId,
    verifyingContract: contract.target as string,
  };
};

const approveERC20IfNeeded = async (
  contract: VouchVault,
  tokenAddress: string,
  amount: bigint,
): Promise<void> => {
  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, contract.runner);
  const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
  const allowance: bigint = await erc20.allowance(signer, contract.target);
  if (allowance < amount) {
    const approveTx = await erc20.approve(contract.target, amount);
    await approveTx.wait();
  }
};

/**
 * Ensure the vault is approved to pull at least `amount` of `tokenAddress` from
 * the connected wallet. Used by the signer side (borrower's collateral / lender's
 * principal) so the counterparty can pull the committed asset at fill time.
 */
export const ensureVaultAllowance = async (tokenAddress: string, amount: bigint): Promise<void> => {
  const contract = await getVouchVaultContract();
  await approveERC20IfNeeded(contract, tokenAddress, amount);
};

/** Generate a cryptographically-random uint256 nonce for signed-order digest uniqueness. */
export const generateNonce = (): bigint => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
};

const parseLoanId = (
  contract: VouchVault,
  receipt: ethers.TransactionReceipt,
  eventName: string,
): bigint => {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === eventName) {
        return parsed.args[0] as bigint;
      }
    } catch {
      // skip logs from other contracts / unknown signatures
    }
  }
  throw new Error(`${eventName} event not found in receipt`);
};

// ---------------------------------------------------------------------------
// Signing helpers
// ---------------------------------------------------------------------------

/**
 * Sign a loan request as the borrower (EIP-712).
 * Returns the signature and the on-chain digest (from hashLoanRequest).
 */
export const signLoanRequest = async (
  request: SignedLoanRequest,
): Promise<{ signature: string; digest: string }> => {
  const contract = await getVouchVaultContract();
  const domain = await buildDomain(contract);
  const signer = contract.runner as ethers.JsonRpcSigner;

  const signature = await signer.signTypedData(
    domain,
    LOAN_REQUEST_TYPES as unknown as Record<string, ethers.TypedDataField[]>,
    request,
  );
  const digest = await contract.hashLoanRequest(request);

  return { signature, digest };
};

/**
 * Sign a lend offer as the lender (EIP-712).
 * Returns the signature and the on-chain digest (from hashLendOffer).
 */
export const signLendOffer = async (
  offer: SignedLendOffer,
): Promise<{ signature: string; digest: string }> => {
  const contract = await getVouchVaultContract();
  const domain = await buildDomain(contract);
  const signer = contract.runner as ethers.JsonRpcSigner;

  const signature = await signer.signTypedData(
    domain,
    LEND_OFFER_TYPES as unknown as Record<string, ethers.TypedDataField[]>,
    offer,
  );
  const digest = await contract.hashLendOffer(offer);

  return { signature, digest };
};

// ---------------------------------------------------------------------------
// Fill helpers
// ---------------------------------------------------------------------------

export type FillResult = {
  receipt: ethers.TransactionReceipt;
  loanId: bigint;
};

/**
 * Fill a signed loan request as the lender (lender supplies principal).
 * - ETH principal: sends value.
 * - ERC20 principal: approves the vault, then calls fillLoanRequest.
 */
export const fillLoanRequest = async (
  request: SignedLoanRequest,
  signature: string,
): Promise<FillResult> => {
  const contract = await getVouchVaultContract();

  let tx: ethers.TransactionResponse;

  if (isNativeTokenAddress(request.principalToken)) {
    tx = await contract.fillLoanRequest(request, signature, { value: request.principalAmount });
  } else {
    await approveERC20IfNeeded(contract, request.principalToken, request.principalAmount);
    tx = await contract.fillLoanRequest(request, signature);
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');

  const loanId = parseLoanId(contract, receipt, 'SignedLoanRequestFilled');
  return { receipt, loanId };
};

/**
 * Fill a signed lend offer as the borrower (borrower supplies collateral).
 * - ETH collateral: sends value.
 * - ERC20 collateral: approves the vault, then calls fillLendOffer.
 */
export const fillLendOffer = async (
  offer: SignedLendOffer,
  collateralAmount: bigint,
  signature: string,
): Promise<FillResult> => {
  const contract = await getVouchVaultContract();

  let tx: ethers.TransactionResponse;

  if (isNativeTokenAddress(offer.collateralToken)) {
    tx = await contract.fillLendOffer(offer, collateralAmount, signature, { value: collateralAmount });
  } else {
    await approveERC20IfNeeded(contract, offer.collateralToken, collateralAmount);
    tx = await contract.fillLendOffer(offer, collateralAmount, signature);
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');

  const loanId = parseLoanId(contract, receipt, 'SignedLendOfferFilled');
  return { receipt, loanId };
};

// ---------------------------------------------------------------------------
// Cancel helpers
// ---------------------------------------------------------------------------

/**
 * Cancel a signed loan request on-chain (borrower cancels their own request).
 */
export const cancelSignedLoanRequest = async (
  request: SignedLoanRequest,
): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const tx: ethers.TransactionResponse = await contract.cancelSignedLoanRequest(request);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};

/**
 * Cancel a signed lend offer on-chain (lender cancels their own offer).
 */
export const cancelSignedLendOffer = async (
  offer: SignedLendOffer,
): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const tx: ethers.TransactionResponse = await contract.cancelSignedLendOffer(offer);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};
