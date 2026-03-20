import { dev } from '$app/environment';
import { createLoanApiRequest } from '$lib/api/loan';
import type { Token } from '$lib/api/tokenList';
import { VOUCH_VAULT_ADDRESS } from '$lib/env';
import { Contract, ContractTransactionResponse, ethers } from 'ethers';
import { SUPPORTED_CHAIN_IDS } from './appkit';
import { safeResolveAddress } from './safeResolveAddress';
import { wallet } from './wallet.svelte';

// Use production ABI in production, dev ABI otherwise
const VouchVaultAbi: { abi: ethers.InterfaceAbi } = await import(
  dev ? '../abi/VouchVault.json' : '../abi/prod/VouchVault.json'
);

export const getVouchVaultContract = async (): Promise<Contract> => {
  if (!window.ethereum) throw new Error('No wallet found');
  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();
  // Always resolve contract address (prevents ENS on unsupported networks)
  const network = await provider.getNetwork();
  let contractAddress: string = VOUCH_VAULT_ADDRESS;

  if (!ethers.isAddress(contractAddress)) {
    if (!SUPPORTED_CHAIN_IDS.includes(network.chainId))
      throw new Error(
        'ENS contract addresses are not supported on this network. Please use a direct Ethereum address.',
      );

    const resolved = await provider.resolveName(contractAddress);
    if (!resolved) throw new Error('ENS contract address could not be resolved.');
    contractAddress = resolved;
  }
  return new ethers.Contract(contractAddress, VouchVaultAbi.abi, signer);
};

/**
 * Create a loan, optionally resolving ENS for the borrower if provided.
 * @param collateralAmount Amount of collateral
 * @param token The token object representing the collateral
 */
export const createLoan = async (collateralAmount: number, token: Token): Promise<ContractTransactionResponse> => {
  const chainId = wallet.chainId;
  const borrower = wallet.address;
  if (!chainId) throw new Error('No chainId in wallet state');
  if (!borrower) throw new Error('No borrower address in wallet state');

  const contract = await getVouchVaultContract();
  const provider = contract.runner?.provider as ethers.BrowserProvider;
  await safeResolveAddress(borrower, provider);

  let receipt: ContractTransactionResponse;

  if (
    token.address === undefined ||
    token.address === '' ||
    token.address === '0x0000000000000000000000000000000000000000'
  ) {
    // ETH collateral
    const parsedCollateral = ethers.parseEther(collateralAmount.toString());
    const tx = await contract.createLoan({ value: parsedCollateral });
    receipt = await tx.wait();
  } else {
    // ERC-20 collateral
    const parsedCollateral = ethers.parseUnits(collateralAmount.toString(), token.decimals ?? 18);
    // Approve the vault to spend tokens
    const erc20 = new ethers.Contract(
      token.address,
      ['function approve(address spender, uint256 amount) public returns (bool)'],
      contract.runner,
    );
    const approveTx = await erc20.approve(contract.target, parsedCollateral);
    await approveTx.wait();
    // Call createLoanWithERC20
    const tx = await contract.createLoanWithERC20(token.address, parsedCollateral);
    receipt = await tx.wait();
  }

  if (!receipt) throw new Error('Transaction failed');

  await createLoanApiRequest({
    chainId,
    collateralAmount,
    collateralTxHash: receipt.hash,
    collateralBlockNumber: receipt.blockNumber ?? 0,
    collateralBlockHash: receipt.blockHash ?? '',
    collateralLockedAt: new Date().toISOString(),
    collateralTokenId: token.id,
  });

  return receipt;
};
