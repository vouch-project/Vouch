import { dev } from '$app/environment';
import { ethers } from 'ethers';
import VouchVaultAbiDev from '../../../../../packages/abi/VouchVault.json';
import VouchVaultAbiProd from '../../../../../packages/abi/prod/VouchVault.json';
import type { Token } from '../../api/chain';
import { chainInfo } from '../stores/chainInfo.svelte';

const VouchVaultAbi = dev ? VouchVaultAbiDev : VouchVaultAbiProd;

export const getVouchVaultContract = async (): Promise<ethers.Contract> => {
  if (!window.ethereum) throw new Error('No wallet found');
  if (!chainInfo.contractAddress) throw new Error('No contract address found for current chain');
  if (!ethers.isAddress(chainInfo.contractAddress)) throw new Error('Invalid contract address');

  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();

  return new ethers.Contract(chainInfo.contractAddress, VouchVaultAbi, signer);
};

const isNativeToken = (token: Token): boolean => !token.address || token.address === ethers.ZeroAddress;

const createEthLoan = async (
  contract: ethers.Contract,
  collateralAmount: string,
  principalToken: Token,
  principalAmount: string,
): Promise<ethers.TransactionResponse> => {
  const value = ethers.parseEther(collateralAmount);
  const principalTokenAddress = isNativeToken(principalToken) ? ethers.ZeroAddress : principalToken.address;
  const principalAmountParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
  return contract.createLoan(principalTokenAddress, principalAmountParsed, { value });
};

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const createErc20Loan = async (
  contract: ethers.Contract,
  token: Token,
  collateralAmount: string,
  principalToken: Token,
  principalAmount: string,
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
  return contract.createLoanWithERC20(token.address, amount, principalTokenAddress, principalAmountParsed);
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
): Promise<CreateLoanResult> => {
  const contract = await getVouchVaultContract();

  const tx = await (isNativeToken(collateralToken)
    ? createEthLoan(contract, collateralAmount, principalToken, principalAmount)
    : createErc20Loan(contract, collateralToken, collateralAmount, principalToken, principalAmount));

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
