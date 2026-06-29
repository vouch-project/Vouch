import type { VouchVault } from '@vouch/contracts';
import { VouchVault__factory } from '@vouch/contracts';
import { ethers } from 'ethers';
import type { Token } from '../../api/chain';
import { chainInfo } from '../stores/chainInfo.svelte';

export const getVouchVaultContract = async (): Promise<VouchVault> => {
  if (!window.ethereum) throw new Error('No wallet found');
  if (!chainInfo.contractAddress) throw new Error('No contract address found for current chain');
  if (!ethers.isAddress(chainInfo.contractAddress)) throw new Error('Invalid contract address');

  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();

  return VouchVault__factory.connect(chainInfo.contractAddress, signer);
};

const isNativeToken = (token: Token): boolean => !token.address || token.address === ethers.ZeroAddress;

const createEthLoan = async (
  contract: VouchVault,
  collateralAmount: string,
  principalToken: Token,
  principalAmount: string,
  interestRateBps: number,
  durationSeconds: number,
  fundWindowSeconds: number,
): Promise<ethers.TransactionResponse> => {
  const value = ethers.parseEther(collateralAmount);
  const principalTokenAddress = isNativeToken(principalToken) ? ethers.ZeroAddress : principalToken.address;
  const principalAmountParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
  return contract.createLoan(
    principalTokenAddress,
    principalAmountParsed,
    interestRateBps,
    durationSeconds,
    fundWindowSeconds,
    { value },
  );
};

const ERC20_ABI = [
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
  return contract.createLoanWithERC20(
    token.address,
    amount,
    principalTokenAddress,
    principalAmountParsed,
    interestRateBps,
    durationSeconds,
    fundWindowSeconds,
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

export const getRepaymentDetails = async (onChainLoanId: bigint): Promise<RepaymentDetails> => {
  const contract = await getVouchVaultContract();
  // `getRepaymentDetails` gives the live-accrued totals; the public `loans` getter
  // gives the monotonic on-chain principal-repaid / collateral-released bookkeeping
  // (which can't be reconstructed client-side because interest keeps accruing).
  const [result, loan] = await Promise.all([
    contract.getRepaymentDetails(onChainLoanId),
    contract.loans(onChainLoanId),
  ]);
  return {
    interestRateBps: Number(result.interestRateBps),
    durationSeconds: result.durationSeconds,
    repaid: result.repaid,
    totalDue: result.totalDue,
    amountRepaid: result.amountRepaid,
    remaining: result.remaining,
    fundDeadline: result.fundDeadline,
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
 * Repay some or all of an ETH-principal loan.
 * @param onChainLoanId   - The on-chain loan ID.
 * @param paymentWei      - Amount to pay in wei (1 to remaining balance).
 */
export const repayLoan = async (onChainLoanId: bigint, paymentWei: bigint): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();
  const tx: ethers.TransactionResponse = await contract.repayLoan(onChainLoanId, { value: paymentWei });
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};

/**
 * Repay some or all of an ERC20-principal loan.
 * @param onChainLoanId      - The on-chain loan ID.
 * @param paymentRaw         - Token amount to pay (raw units, ≤ remaining).
 * @param principalToken     - The principal token (used for approval).
 */
export const repayLoanWithERC20 = async (
  onChainLoanId: bigint,
  paymentRaw: bigint,
  principalTokenAddress: string,
): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();

  const erc20 = new ethers.Contract(principalTokenAddress, ERC20_ABI, contract.runner);
  const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
  const allowance: bigint = await erc20.allowance(signer, contract.target);
  if (allowance < paymentRaw) {
    const approveTx = await erc20.approve(contract.target, paymentRaw);
    await approveTx.wait();
  }

  const tx: ethers.TransactionResponse = await contract.repayLoanWithERC20(onChainLoanId, paymentRaw);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
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
    tx = await contract.fundLoanWithERC20(onChainLoanId, principalTokenAddress, principalRawAmount);
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
