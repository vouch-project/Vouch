import { ethers } from 'ethers';

/**
 * Formats a raw on-chain token amount (in base units) into a human-readable string
 * with locale-formatted integer part and up to 4 decimal places (trailing zeros trimmed).
 */
export const formatUint256 = (
  amount: string | null,
  decimals?: number | null,
  truncateDecimals?: number | null,
): string => {
  if (amount === null || amount === '') return '0';

  try {
    // Convert to BigInt first — ethers v6's getBigInt rejects JS Numbers > MAX_SAFE_INTEGER,
    // which can happen when large uint256 strings from Postgres get coerced to Number by JSON parsing.
    const formatted = ethers.formatUnits(BigInt(amount), decimals ?? 18);
    const [whole, fraction] = formatted.split('.');

    // Use BigInt to safely format the integer part with locale commas, avoiding Number() precision loss
    const wholeFormatted = BigInt(whole).toLocaleString();

    if (!fraction) return wholeFormatted;

    // Truncate to the specified number of decimal places (default 4) and remove trailing zeros
    const trimmedFraction = fraction.slice(0, truncateDecimals ?? 4).replace(/0+$/, '');

    return trimmedFraction.length > 0 ? `${wholeFormatted}.${trimmedFraction}` : wholeFormatted;
  } catch (err) {
    console.error('Format error:', err);
    return '0';
  }
};
