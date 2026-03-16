import { BACKEND_API_URL } from '$lib/env';
import { ethers } from 'ethers';

/**
 * Sends a signed request to the /loan API endpoint.
 * @param body The loan creation payload (object with your business fields)
 * @param signer An ethers.js Signer instance (e.g., from MetaMask)
 * @returns The API response JSON
 */
export const createLoanApiRequest = async (body: Record<string, unknown>, signer: ethers.Signer) => {
  // Prepare the message to sign (could be a hash or a stringified payload)
  const message = JSON.stringify({ ...body, timestamp: Date.now() }); // Include timestamp to prevent replay attacks
  const address = await signer.getAddress();
  const signature = await signer.signMessage(message);

  const response = await fetch(`${BACKEND_API_URL}/loan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-message': message,
      'x-signature': signature,
      'x-address': address,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
};
