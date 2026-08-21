import { ethers } from 'ethers';
import { buildDomain, LOAN_REQUEST_TYPES, verifyLoanRequest } from './eip712';

describe('eip712', () => {
  it('verifyLoanRequest recovers the signer', async () => {
    const wallet = ethers.Wallet.createRandom();
    const domain = buildDomain(31337n, '0x1111111111111111111111111111111111111111');
    const value = {
      borrower: wallet.address, collateralToken: '0x0000000000000000000000000000000000000002',
      collateralAmount: '1000', principalToken: ethers.ZeroAddress, principalAmount: '500',
      interestRateBps: 800, durationSeconds: '2592000', maxLtvBps: 6500, nonce: '1', deadline: '9999999999',
    };
    const signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, value);
    const res = verifyLoanRequest(value, signature, domain);
    expect(res.valid).toBe(true);
    expect(res.signer.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(res.digest).toBe(ethers.TypedDataEncoder.hash(domain, LOAN_REQUEST_TYPES, value));
  });

  it('verifyLoanRequest rejects a tampered value', async () => {
    const wallet = ethers.Wallet.createRandom();
    const domain = buildDomain(31337n, '0x1111111111111111111111111111111111111111');
    const value = { borrower: wallet.address, collateralToken: '0x0000000000000000000000000000000000000002',
      collateralAmount: '1000', principalToken: ethers.ZeroAddress, principalAmount: '500',
      interestRateBps: 800, durationSeconds: '2592000', maxLtvBps: 6500, nonce: '1', deadline: '9999999999' };
    const signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, value);
    const res = verifyLoanRequest({ ...value, principalAmount: '999' }, signature, domain);
    expect(res.signer.toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });
});
