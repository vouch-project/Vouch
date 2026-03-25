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
): Promise<ethers.TransactionResponse> => {
  const value = ethers.parseEther(collateralAmount);
  return contract.createLoan({ value });
};

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const createErc20Loan = async (
  contract: ethers.Contract,
  token: Token,
  collateralAmount: string,
): Promise<ethers.TransactionResponse> => {
  const amount = ethers.parseUnits(collateralAmount, token.decimals ?? 18);

  const erc20 = new ethers.Contract(token.address, ERC20_ABI, contract.runner);
  const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
  const allowance: bigint = await erc20.allowance(signer, contract.target);

  if (allowance < amount) {
    const approveTx = await erc20.approve(contract.target, amount);
    await approveTx.wait();
  }

  return contract.createLoanWithERC20(token.address, amount);
};

export const createLoan = async (collateralAmount: string, token: Token): Promise<ethers.TransactionReceipt> => {
  const contract = await getVouchVaultContract();

  const tx = await (isNativeToken(token)
    ? createEthLoan(contract, collateralAmount)
    : createErc20Loan(contract, token, collateralAmount));

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};
