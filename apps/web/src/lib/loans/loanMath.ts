/**
 * Pure helpers for deriving loan repayment figures.
 *
 * `loans.interestRate` is a uint256 (string) scaled so that 1e18 == one
 * percentage point — matching the marketplace's `formatUint256(rate) + "%"`.
 * So 5% is stored as 5e18. All math stays in bigint to avoid precision loss.
 */
export const PERCENT_WAD = 10n ** 18n;

/** Total amount owed = principal + interest. */
export const computeTotalDue = (principalRaw: bigint, interestRateRaw: bigint): bigint =>
  principalRaw + (principalRaw * interestRateRaw) / (100n * PERCENT_WAD);

/** Convert the WAD-scaled interest rate into basis points (1% = 100 bps). */
export const interestRateToBps = (interestRateRaw: bigint): number => Number((interestRateRaw * 100n) / PERCENT_WAD);

/** Repayment progress as a 0–100 integer percentage. */
export const computeProgressPct = (amountRepaid: bigint, totalDue: bigint, repaid: boolean): number =>
  totalDue > 0n ? Number((amountRepaid * 100n) / totalDue) : repaid ? 100 : 0;

/** Remaining balance, floored at zero. */
export const computeRemaining = (totalDue: bigint, amountRepaid: bigint): bigint =>
  totalDue > amountRepaid ? totalDue - amountRepaid : 0n;

/** Human-readable "Due in Nd" / "Overdue by Nd" / "Due today" label. */
export const formatDueDateLabel = (dueDate: Date | null): string => {
  if (!dueDate) return 'No deadline';
  const diff = dueDate.getTime() - Date.now();
  // Check the sign before rounding: Math.ceil() of a small negative diff is 0,
  // which would mislabel a <1d overdue loan as "Due today".
  if (diff < 0) return `Overdue by ${Math.ceil(Math.abs(diff) / 86400000)}d`;
  const days = Math.ceil(diff / 86400000);
  if (days === 0) return 'Due today';
  return `Due in ${days}d`;
};
