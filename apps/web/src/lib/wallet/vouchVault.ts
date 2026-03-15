import { Contract, ContractTransactionResponse, ethers } from 'ethers';
import VouchVaultAbi from '../abi/VouchVault.json';
import { safeResolveAddress } from './safeResolveAddress';

// Replace with your deployed contract address
// Example: export const VOUCH_VAULT_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const VOUCH_VAULT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

export interface Loan {
  borrower: string;
  collateralAmount: bigint;
  createdAt: bigint;
  active: boolean;
}

export const getVouchVaultContract = async (): Promise<Contract> => {
  if (!window.ethereum) throw new Error('No wallet found');
  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();
  // Always resolve contract address (prevents ENS on unsupported networks)
  const supportedChainIds = [1, 11155111, 5, 3, 4, 137, 42161];
  const network = await provider.getNetwork();
  let contractAddress: string = VOUCH_VAULT_ADDRESS;
  if (!ethers.isAddress(contractAddress)) {
    if (!supportedChainIds.includes(Number(network.chainId))) {
      throw new Error(
        'ENS contract addresses are not supported on this network. Please use a direct Ethereum address.',
      );
    }
    const resolved = await provider.resolveName(contractAddress);
    if (!resolved) throw new Error('ENS contract address could not be resolved.');
    contractAddress = resolved;
  }
  return new ethers.Contract(contractAddress, VouchVaultAbi.abi as ethers.InterfaceAbi, signer);
};

/**
 * Create a loan, optionally resolving ENS for the borrower if provided.
 * @param collateralEth Amount of ETH collateral
 * @param borrower ENS name or address (optional, defaults to signer)
 */
export const createLoan = async (
  collateralEth: number | string,
  borrower?: string,
): Promise<ContractTransactionResponse> => {
  const contract = await getVouchVaultContract();
  if (borrower) {
    // Use provider from contract and resolve, but not used in contract call (for future use)
    const provider = contract.runner?.provider as ethers.BrowserProvider;
    await safeResolveAddress(borrower, provider);
  }
  const parsedCollateral = ethers.parseEther(collateralEth.toString());
  const tx = await contract.createLoan({ value: parsedCollateral });
  return tx.wait();
};

export const getLoan = async (loanId: number | string): Promise<Loan> => {
  const contract = await getVouchVaultContract();
  const [borrower, collateralAmount, createdAt, active] = await contract.getLoan(loanId);
  return {
    borrower,
    collateralAmount,
    createdAt,
    active,
  };
};
