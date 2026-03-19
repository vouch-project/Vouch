import { loginWithWallet } from '$lib/api/loginWithWallet';
import { ethers } from 'ethers';

/**
 * Attempts to login the user with their connected wallet.
 * Call this after wallet connection, e.g. in your Svelte component or store.
 * @param signer ethers.js Signer instance
 * @returns The JWT token
 */
export const loginUserWithWallet = async () => {
  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();

  await loginWithWallet(signer);
};
