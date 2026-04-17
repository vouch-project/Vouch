import { ethers } from 'ethers';

declare const AddressBrand: unique symbol;
export type Address = string & { readonly [AddressBrand]: void };

export const validAddress = (address: string): Address | null => {
  try {
    return ethers.getAddress(address) as Address;
  } catch {
    return null;
  }
};

export const isAddress = (address: string): address is Address =>
  validAddress(address) !== null;

export const asAddress = (address: string): Address => {
  const v = validAddress(address);
  if (v === null) throw new Error(`Invalid address: ${address}`);
  return v;
};
