import { ethers } from 'ethers';
import { jwtDecode, type JwtPayload } from 'jwt-decode';
import { JWT_STORAGE_KEY } from '../constants';
import { axiosApi } from './axios';

interface DecodedJwt extends JwtPayload {
  address?: string;
}

const isJwtValid = (token: string, address: string): boolean => {
  try {
    const decoded = jwtDecode<DecodedJwt>(token);

    if (!decoded?.address || !decoded?.exp) return false;

    const isCorrectUser = decoded.address.toLowerCase() === address.toLowerCase();

    const currentTime = Math.floor(Date.now() / 1000);
    const isNotExpired = decoded.exp > currentTime;

    return isCorrectUser && isNotExpired;
  } catch {
    return false;
  }
};

export const loginWithWallet = async (): Promise<string> => {
  const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
  const signer = await provider.getSigner();

  const address = await signer.getAddress();
  const existingToken = localStorage.getItem(JWT_STORAGE_KEY);

  if (existingToken && isJwtValid(existingToken, address)) return existingToken;

  const { nonce } = (await axiosApi.get('/auth/nonce', { params: { address } })).data;

  const loginMessage = `Sign this message to login to Vouch.\n\nNonce: ${nonce}`;
  const signature = await signer.signMessage(loginMessage);

  const { token } = (
    await axiosApi.post('/auth/login', {
      address,
      signature,
      loginMessage,
    })
  ).data;

  localStorage.setItem(JWT_STORAGE_KEY, token);
  return token;
};
