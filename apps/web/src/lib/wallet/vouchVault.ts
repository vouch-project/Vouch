import { dev } from '$app/environment';
import { Contract, ContractTransactionResponse, ethers } from 'ethers';
import VouchVaultAbiDev from '../../../../../packages/abi/VouchVault.json';
import VouchVaultAbiProd from '../../../../../packages/abi/prod/VouchVault.json';
import type { Token } from '../../api/chain';
import { chainInfo } from '../stores/chainInfo.svelte';

const VouchVaultAbi = dev ? VouchVaultAbiDev : VouchVaultAbiProd;

export const getVouchVaultContract = async (): Promise<Contract> => {
  if (!window.ethereum) throw new Error('No wallet found');
  if (!chainInfo.contractAddress) throw new Error('No contract address found for current chain');
  if (!ethers.isAddress(chainInfo.contractAddress)) throw new Error('Invalid contract address');

  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();

  return new ethers.Contract(chainInfo.contractAddress, VouchVaultAbi.abi, signer);
};

const isNativeToken = (token: Token): boolean => !token.address || token.address === ethers.ZeroAddress;

const createEthLoan = async (contract: Contract, collateralAmount: number) => {
  const value = ethers.parseEther(collateralAmount.toString());
  const tx = await contract.createLoan({ value });
  return tx.wait();
};

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const createErc20Loan = async (contract: Contract, token: Token, collateralAmount: number) => {
  const amount = ethers.parseUnits(collateralAmount.toString(), token.decimals ?? 18);

  const erc20 = new ethers.Contract(token.address, ERC20_ABI, contract.runner);
  const signer = await (contract.runner as ethers.JsonRpcSigner).getAddress();
  const allowance: bigint = await erc20.allowance(signer, contract.target);

  if (allowance < amount) {
    const approveTx = await erc20.approve(contract.target, amount);
    await approveTx.wait();
  }

  const tx = await contract.createLoanWithERC20(token.address, amount);
  return tx.wait();
};

export const createLoan = async (collateralAmount: number, token: Token): Promise<ContractTransactionResponse> => {
  const contract = await getVouchVaultContract();

  const receipt = isNativeToken(token)
    ? await createEthLoan(contract, collateralAmount)
    : await createErc20Loan(contract, token, collateralAmount);

  if (!receipt) throw new Error('Transaction failed');
  return receipt;
};
