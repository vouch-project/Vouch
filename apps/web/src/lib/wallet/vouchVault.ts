import type { VouchVault } from '@vouch/contracts';
import { VouchVault__factory } from '@vouch/contracts';
import { ethers } from 'ethers';
import type { Token } from '../../api/chain';
import type { LtvAttestation } from '../loans/creditScore';
import { chainInfo } from '../stores/chainInfo.svelte';

export const getVouchVaultContract = async (): Promise<VouchVault> => {
  if (!window.ethereum) throw new Error('No wallet found');
  if (!chainInfo.contractAddress) throw new Error('No contract address found for current chain');
  if (!ethers.isAddress(chainInfo.contractAddress)) throw new Error('Invalid contract address');

  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();

  return VouchVault__factory.connect(chainInfo.contractAddress, signer);
};

export const isNativeTokenAddress = (address: string): boolean =>
  !address || address === ethers.ZeroAddress;

const isNativeToken = (token: Token): boolean => isNativeTokenAddress(token.address);

const createEthLoan = async (
  contract: VouchVault,
  collateralAmount: string,
  principalToken: Token,
  principalAmount: string,
  interestRateBps: number,
  durationSeconds: number,
  fundWindowSeconds: number,
  liquidationThresholdBps: number,
  attestation: LtvAttestation,
): Promise<ethers.TransactionResponse> => {
  const value = ethers.parseEther(collateralAmount);
  const principalTokenAddress = isNativeToken(principalToken) ? ethers.ZeroAddress : principalToken.address;
  const principalAmountParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
  return contract.createLoan(
    ethers.ZeroAddress,
    0n,
    principalTokenAddress,
    principalAmountParsed,
    interestRateBps,
    durationSeconds,
    fundWindowSeconds,
    liquidationThresholdBps,
    attestation.maxLtvBps,
    attestation.expiry,
    attestation.sig,
    { value },
  );
};

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const createErc20Loan = async (
  contract: VouchVault,
  token: Token,
  collateralAmount: string,
  principalToken: Token,
  principalAmount: string,
  interestRateBps: number,
  durationSeconds: number,
  fundWindowSeconds: number,
  liquidationThresholdBps: number,
  attestation: LtvAttestation,
): Promise<ethers.TransactionResponse> => {
  const amount = ethers.parseUnits(collateralAmount, token.decimals ?? 18);

  const erc20 = new ethers.Contract(token.address, ERC20_ABI, contract.runner);
  const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
  const allowance: bigint = await erc20.allowance(signer, contract.target);

  if (allowance < amount) {
    const approveTx = await erc20.approve(contract.target, amount);
    await approveTx.wait();
  }

  const principalTokenAddress = isNativeToken(principalToken) ? ethers.ZeroAddress : principalToken.address;
  const principalAmountParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
  return contract.createLoan(
    token.address,
    amount,
    principalTokenAddress,
    principalAmountParsed,
    interestRateBps,
    durationSeconds,
    fundWindowSeconds,
    liquidationThresholdBps,
    attestation.maxLtvBps,
    attestation.expiry,
    attestation.sig,
  );
};

export type CreateLoanResult = {
  receipt: ethers.TransactionReceipt;
  onChainLoanId: bigint;
};

export const createLoan = async (
  collateralAmount: string,
  collateralToken: Token,
  principalToken: Token,
  principalAmount: string,
  interestRateBps: number,
  durationSeconds: number,
  fundWindowSeconds: number,
  liquidationThresholdBps: number,
  attestation: LtvAttestation,
): Promise<CreateLoanResult> => {
  const contract = await getVouchVaultContract();

  const tx = await (isNativeToken(collateralToken)
    ? createEthLoan(
        contract,
        collateralAmount,
        principalToken,
        principalAmount,
        interestRateBps,
        durationSeconds,
        fundWindowSeconds,
        liquidationThresholdBps,
        attestation,
      )
    : createErc20Loan(
        contract,
        collateralToken,
        collateralAmount,
        principalToken,
        principalAmount,
        interestRateBps,
        durationSeconds,
        fundWindowSeconds,
        liquidationThresholdBps,
        attestation,
      ));

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');

  let onChainLoanId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'LoanCreated') {
        onChainLoanId = parsed.args[0] as bigint;
        break;
      }
    } catch {
      // skip logs from other contracts / unknown signatures
    }
  }

  if (onChainLoanId === undefined) throw new Error('LoanCreated event not found in receipt');

  return { receipt, onChainLoanId };
};

export type RepaymentDetails = {
  interestRateBps: number;
  durationSeconds: bigint;
  repaid: boolean;
  totalDue: bigint;
  amountRepaid: bigint;
  remaining: bigint;
  fundDeadline: bigint;
  principalRepaid: bigint;
  collateralReleased: bigint;
};

const ACCRUAL_PERIOD = 86400n;
const PERIODS_PER_YEAR = 365n;

export const getRepaymentDetails = async (onChainLoanId: bigint): Promise<RepaymentDetails> => {
  const contract = await getVouchVaultContract();
  const loan = await contract.loans(onChainLoanId);

  let owed = loan.interestAccrued;
  if (loan.funded && loan.durationSeconds > 0n) {
    const from = loan.lastAccrualAt === 0n ? loan.fundedAt : loan.lastAccrualAt;
    const dueAt = loan.fundedAt + loan.durationSeconds;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const cappedNow = nowSec < dueAt ? nowSec : dueAt;
    if (cappedNow > from) {
      const periods = (cappedNow - from) / ACCRUAL_PERIOD;
      const outstanding = loan.principalAmount - loan.principalRepaid;
      owed += (outstanding * loan.interestRateBps * periods) / (10000n * PERIODS_PER_YEAR);
    }
  }

  const totalDue = loan.repaid ? loan.amountRepaid : loan.funded ? loan.principalAmount + owed : 0n;
  const remaining = totalDue > loan.amountRepaid ? totalDue - loan.amountRepaid : 0n;

  return {
    interestRateBps: Number(loan.interestRateBps),
    durationSeconds: loan.durationSeconds,
    repaid: loan.repaid,
    totalDue,
    amountRepaid: loan.amountRepaid,
    remaining,
    fundDeadline: loan.fundDeadline,
    principalRepaid: loan.principalRepaid,
    collateralReleased: loan.collateralReleased,
  };
};

/**
 * Read the protocol fee (basis points) taken from the interest portion of repayments.
 * 1000 = 10%. Lenders net `grossInterest * (1 - protocolFeeBps / 10000)`.
 */
export const getProtocolFeeBps = async (): Promise<number> => {
  if (!window.ethereum) throw new Error('No wallet found');
  if (!chainInfo.contractAddress) throw new Error('No contract address found for current chain');
  if (!ethers.isAddress(chainInfo.contractAddress)) throw new Error('Invalid contract address');

  // Read-only: do not require a signer (avoids prompting the user to connect).
  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const contract = VouchVault__factory.connect(chainInfo.contractAddress, provider);
  return Number(await contract.protocolFeeBps());
};

/**
 * Repay some or all of a loan.
 * @param onChainLoanId        - The on-chain loan ID.
 * @param paymentRaw           - Amount to pay in smallest units (1 to remaining balance).
 * @param principalTokenAddress - ERC20 principal token address; omit or use ZeroAddress for native ETH.
 */
export const repayLoan = async (
  onChainLoanId: bigint,
  paymentRaw: bigint,
  principalTokenAddress?: string,
): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  let tx: ethers.TransactionResponse;

  if (!principalTokenAddress || principalTokenAddress === ethers.ZeroAddress) {
    tx = await contract.repayLoan(onChainLoanId, 0n, { value: paymentRaw });
  } else {
    const erc20 = new ethers.Contract(principalTokenAddress, ERC20_ABI, contract.runner);
    const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
    const allowance: bigint = await erc20.allowance(signer, contract.target);
    if (allowance < paymentRaw) {
      const approveTx = await erc20.approve(contract.target, paymentRaw);
      await approveTx.wait();
    }
    tx = await contract.repayLoan(onChainLoanId, paymentRaw);
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};

/**
 * Returns the health factor for a funded, non-repaid loan.
 * Scaled to 1e18: 1e18n = 1.0, 1.5e18n = 1.5, etc.
 * Reverts if loan is not funded or already repaid.
 */
export const getHealthFactor = async (onChainLoanId: bigint): Promise<bigint> => {
  const contract = await getVouchVaultContract();
  return contract.getHealthFactor(onChainLoanId) as Promise<bigint>;
};

/**
 * Fund an active loan by sending its requested principal to the borrower.
 * Handles both native ETH (principalTokenAddress == address(0)) and ERC20 tokens.
 *
 * @param onChainLoanId          - The on-chain uint256 loan ID.
 * @param principalRawAmount     - The raw principal amount (smallest unit) from `loans.principalAmount`.
 * @param principalTokenAddress  - The principal token address from `loans.requestedPrincipalToken`
 *                                 (use ethers.ZeroAddress for native ETH).
 */
export const fundLoan = async (
  onChainLoanId: bigint,
  principalRawAmount: bigint,
  principalTokenAddress: string,
): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();

  let tx: ethers.TransactionResponse;

  if (!principalTokenAddress || principalTokenAddress === ethers.ZeroAddress) {
    // Native ETH
    tx = await contract.fundLoan(onChainLoanId, { value: principalRawAmount });
  } else {
    // ERC20 — approve first, then fund
    const erc20 = new ethers.Contract(principalTokenAddress, ERC20_ABI, contract.runner);
    const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
    const allowance: bigint = await erc20.allowance(signer, contract.target);
    if (allowance < principalRawAmount) {
      const approveTx = await erc20.approve(contract.target, principalRawAmount);
      await approveTx.wait();
    }
    tx = await contract.fundLoan(onChainLoanId);
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};

/**
 * Cancel an unfunded loan and reclaim collateral. Only the borrower may call this on-chain.
 * @param onChainLoanId - The on-chain uint256 loan ID.
 */
export const cancelLoan = async (onChainLoanId: bigint): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const tx: ethers.TransactionResponse = await contract.cancelLoan(onChainLoanId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};

/**
 * Read the amount the connected wallet can claim for a given token. Repayments and
 * protocol fees are normally pushed straight to the recipient; they are only credited
 * here (for a manual pull) when that direct transfer fails — e.g. the recipient is a
 * contract that rejects the funds. Claim credited balances with {@link withdrawPayments}.
 * @param tokenAddress - Token to query (use ethers.ZeroAddress for native ETH).
 * @param account      - Optional account; defaults to the connected signer.
 */
export const getPendingPayments = async (tokenAddress: string, account?: string): Promise<bigint> => {
  const contract = await getVouchVaultContract();
  const owner = account ?? (await (contract.runner as ethers.JsonRpcSigner).getAddress());
  const token = !tokenAddress || tokenAddress === ethers.ZeroAddress ? ethers.ZeroAddress : tokenAddress;
  return contract.pendingPayments(owner, token);
};

/**
 * Withdraw funds credited to the connected wallet (lender repayments/interest or
 * protocol fees that could not be delivered directly) for a given token.
 * @param tokenAddress - Token to withdraw (use ethers.ZeroAddress for native ETH).
 */
export const withdrawPayments = async (tokenAddress: string): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const token = !tokenAddress || tokenAddress === ethers.ZeroAddress ? ethers.ZeroAddress : tokenAddress;
  const tx: ethers.TransactionResponse = await contract.withdrawPayments(token);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};

export type CreateLendOfferResult = {
  receipt: ethers.TransactionReceipt;
  onChainOfferId: bigint;
};

export const createLendOffer = async (
  principalToken: Token,
  principalAmount: string,
  collateralRatioBps: number,
  trustedRatioBps: number,
  scoreThreshold: number,
  maxLtvBps: number,
  rateBps: number,
  durationSeconds: number,
  acceptWindowSeconds: number,
): Promise<CreateLendOfferResult> => {
  const contract = await getVouchVaultContract();

  let tx: ethers.TransactionResponse;

  if (isNativeToken(principalToken)) {
    const value = ethers.parseEther(principalAmount);
    tx = await contract.createLendOffer(
      ethers.ZeroAddress,
      0n,
      collateralRatioBps,
      trustedRatioBps,
      scoreThreshold,
      maxLtvBps,
      rateBps,
      durationSeconds,
      acceptWindowSeconds,
      { value },
    );
  } else {
    const principalAmountParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
    const erc20 = new ethers.Contract(principalToken.address, ERC20_ABI, contract.runner);
    const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
    const allowance: bigint = await erc20.allowance(signer, contract.target);
    if (allowance < principalAmountParsed) {
      const approveTx = await erc20.approve(contract.target, principalAmountParsed);
      await approveTx.wait();
    }
    tx = await contract.createLendOffer(
      principalToken.address,
      principalAmountParsed,
      collateralRatioBps,
      trustedRatioBps,
      scoreThreshold,
      maxLtvBps,
      rateBps,
      durationSeconds,
      acceptWindowSeconds,
    );
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');

  let onChainOfferId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'LendOfferCreated') {
        onChainOfferId = parsed.args[0] as bigint;
        break;
      }
    } catch {
      // skip logs from other contracts
    }
  }

  if (onChainOfferId === undefined) throw new Error('LendOfferCreated event not found in receipt');
  return { receipt, onChainOfferId };
};

export type AcceptLendOfferResult = {
  receipt: ethers.TransactionReceipt;
  loanId: bigint;
};

export type ScoreAttestation = { score: number; expiry: number; sig: string };

export const acceptLendOffer = async (
  offerId: bigint,
  collateralToken: Token,
  collateralAmount: string,
  attestation?: ScoreAttestation,
): Promise<AcceptLendOfferResult> => {
  const contract = await getVouchVaultContract();
  const collateralParsed = ethers.parseUnits(collateralAmount, collateralToken.decimals ?? 18);
  const score = attestation?.score ?? 0;
  const expiry = attestation?.expiry ?? 0;
  const sig = attestation?.sig ?? '0x';

  let tx: ethers.TransactionResponse;

  if (isNativeToken(collateralToken)) {
    tx = await contract.acceptLendOffer(offerId, ethers.ZeroAddress, 0n, score, expiry, sig, {
      value: collateralParsed,
    });
  } else {
    const erc20 = new ethers.Contract(collateralToken.address, ERC20_ABI, contract.runner);
    const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
    const allowance: bigint = await erc20.allowance(signer, contract.target);
    if (allowance < collateralParsed) {
      const approveTx = await erc20.approve(contract.target, collateralParsed);
      await approveTx.wait();
    }
    tx = await contract.acceptLendOffer(offerId, collateralToken.address, collateralParsed, score, expiry, sig);
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');

  let loanId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'LendOfferAccepted') {
        loanId = parsed.args[1] as bigint;
        break;
      }
    } catch {
      // skip logs from other contracts
    }
  }

  if (loanId === undefined) throw new Error('LendOfferAccepted event not found in receipt');
  return { receipt, loanId };
};

export const cancelLendOffer = async (offerId: bigint): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const tx: ethers.TransactionResponse = await contract.cancelLendOffer(offerId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};
