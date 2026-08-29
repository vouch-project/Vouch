/**
 * Maps known VouchVault custom error selectors to user-facing messages.
 * Selectors are the first 4 bytes of keccak256(errorSignature), hex-encoded.
 */
const CONTRACT_ERRORS: Record<string, string> = {
  '0x9cb13087': 'This lend offer has expired.',
  '0x93f1b0b3': 'This lend offer has already been accepted.',
  '0x9b0104d6': 'This lend offer is not active.',
  '0xadf2fc5f': 'This lend offer is still active and cannot be cancelled yet.',
  '0xd345ccd8': 'LTV attestation has expired — please try again.',
  '0x8370c080': 'Collateral amount exceeds the attested LTV maximum.',
  '0x015c8a96': 'Invalid LTV attestation.',
  '0x2ff2465c': 'This loan has already been repaid.',
  '0x082f7846': 'This loan is not active.',
  '0x35b53dbd': 'This loan has not been funded yet.',
  '0x2dc84599': 'This loan has already been funded.',
  '0xc4380c4f': 'This loan cannot be expired yet.',
  '0xf88f6149': 'This loan is undercollateralized.',
  '0xeff4a023': 'This loan is not liquidatable.',
  '0xe030c251': 'The funding window for this loan has passed.',
  '0x98393509': 'Payment exceeds the amount owed.',
  '0xd0120340': 'Payment exceeds the maximum allowed.',
  '0x0ac9915d': 'Only the borrower can perform this action.',
  '0xf392cc79': 'Only the lender can perform this action.',
  '0xceb5e1b8': 'The borrower cannot fund their own loan.',
  '0x8baa579f': 'Invalid signature.',
  '0x900bb2c9': 'This signature has already been used.',
  '0xf4d678b8': 'Insufficient balance.',
  '0xd0d04f60': 'Nothing to withdraw.',
  '0x2c5211c6': 'Invalid amount.',
  '0x7c946ed7': 'Amount cannot be zero.',
  '0xcc43410f': 'Unexpected ETH sent.',
  '0xfb94c4ed': 'No price feed available for this token.',
  '0x00bfc921': 'Oracle returned an invalid price.',
  '0x19abf40e': 'Oracle price is stale.',
  '0x04d28871': 'Oracle round is stale.',
  '0x159c98a0': 'Oracle round is not complete.',
  '0xf45b4a72': 'Oracle price timestamp is in the future.',
  '0xe2319d4d': 'Principal token does not match the offer.',
  '0x9bfa3c17': 'Fee-on-transfer tokens are not supported.',
  '0x6d963f88': 'ETH transfer failed.',
};

/**
 * Extract a user-facing message from any error thrown during a contract
 * interaction. Handles:
 *  - User-rejected transactions (ACTION_REJECTED)
 *  - Known VouchVault custom error selectors (CALL_EXCEPTION with data)
 *  - NestJS API error responses
 *  - Generic ethers / JS errors
 */
export const parseContractError = (e: unknown, fallback: string): string => {
  if (!e || typeof e !== 'object') return fallback;

  const err = e as {
    code?: unknown;
    data?: unknown;
    info?: { error?: { message?: string } };
    response?: { data?: { message?: unknown } };
    message?: unknown;
  };

  if (err.code === 'ACTION_REJECTED') return 'Transaction rejected.';

  if (err.code === 'CALL_EXCEPTION' && typeof err.data === 'string') {
    const selector = err.data.slice(0, 10).toLowerCase();
    const known = CONTRACT_ERRORS[selector];
    if (known) return known;
  }

  const apiMsg = err.response?.data?.message;
  if (typeof apiMsg === 'string') return apiMsg;
  if (Array.isArray(apiMsg)) return apiMsg.join(', ');

  if (err.info?.error?.message) return err.info.error.message;

  if (typeof err.message === 'string') {
    // Strip ethers' verbose prefix and the full transaction dump that follows
    // the first parenthesised clause, e.g.:
    // "execution reverted (unknown custom error) (action="estimateGas", ...)"
    //  → "execution reverted (unknown custom error)"
    const stripped = err.message
      .replace(/^[\w-]+:\s*/, '') // strip leading "Error: " etc.
      .replace(/\s*\(action=.*$/s, '') // strip ethers metadata dump
      .trim();
    return stripped || fallback;
  }

  return fallback;
};
