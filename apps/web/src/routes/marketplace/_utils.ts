import type { Token } from '$api/chain';
import { chainInfo } from '$lib/stores/chainInfo.svelte';
import { isNativeTokenAddress } from '$lib/wallet/vouchVault';
import { ethers } from 'ethers';

export const truncateAddress = (addr: string): string => {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

export const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) {
    const err = e as { code?: unknown; reason?: unknown };
    if (err.code === 'ACTION_REJECTED') return 'Transaction rejected.';
    if (typeof err.reason === 'string' && err.reason) return err.reason;
    const msg = e.message.replace(/^[\w-]+:\s*/, '');
    return msg || 'An unexpected error occurred.';
  }
  return 'An unexpected error occurred.';
};

export const findToken = (tokenId: string | null): Token | null => {
  if (!tokenId) return chainInfo.tokens?.find((t) => isNativeTokenAddress(t.address)) ?? null;
  return chainInfo.tokens?.find((t) => t.id === tokenId) ?? null;
};

export const tokenAddress = (tokenId: string | null): string | undefined => {
  if (!tokenId) return ethers.ZeroAddress;
  return findToken(tokenId)?.address;
};

export const deadlineSeconds = (iso: string): bigint =>
  BigInt(Math.floor(Date.parse(iso) / 1000));

// 50 bps (0.5%) overshoot on collateral calculations to absorb Chainlink vs
// cached-price divergence and avoid "Collateral value below required ratio" reverts.
export const COLLATERAL_BUFFER_BPS = 50n;

export type LendOfferRow = {
  id: string;
  onChainOfferId: string;
  lenderAddress: string;
  principalAmount: string;
  collateralRatioBps: number;
  trustedRatioBps: number;
  scoreThreshold: number;
  maxLtvBps: number;
  interestRateBps: number;
  duration: string;
  acceptDeadline: string;
  status: string;
  principalToken: { symbol: string; decimals: number; address: string } | null;
};
