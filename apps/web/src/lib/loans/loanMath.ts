/**
 * Pure helpers for deriving loan repayment figures.
 *
 * `loans.interestRate` is stored as the contract's ANNUAL interest rate in basis points
 * (e.g. 500 = 5% APR). Interest accrues per whole day, simple (no compounding), capped at
 * the loan duration — mirroring VouchVault._accruedInterest:
 *   accrued = principal * bps * elapsedDays / (10000 * 365)
 * All money math stays in bigint to avoid precision loss.
 */
const BPS_DENOMINATOR = 10000n;
const DAYS_PER_YEAR = 365n;
const SECONDS_PER_DAY = 86400n;

/** Whole days elapsed between funding and `now`, capped at the loan duration. */
const cappedElapsedDays = (fundedAtMs: number, durationSeconds: bigint, nowMs: number): bigint => {
  if (durationSeconds <= 0n) return 0n;
  const dueAtMs = fundedAtMs + Number(durationSeconds) * 1000;
  const cappedNowMs = Math.min(nowMs, dueAtMs);
  const elapsedSeconds = BigInt(Math.max(0, Math.floor((cappedNowMs - fundedAtMs) / 1000)));
  return elapsedSeconds / SECONDS_PER_DAY;
};

/** Per-day simple interest accrued so far (raw token units), capped at duration. */
export const computeAccruedInterest = (
  principalRaw: bigint,
  interestRateBps: bigint,
  fundedAtMs: number,
  durationSeconds: bigint,
  nowMs: number = Date.now(),
): bigint => {
  const days = cappedElapsedDays(fundedAtMs, durationSeconds, nowMs);
  return (principalRaw * interestRateBps * days) / (BPS_DENOMINATOR * DAYS_PER_YEAR);
};

/** Total amount owed right now = principal + accrued interest. */
export const computeTotalDue = (
  principalRaw: bigint,
  interestRateBps: bigint,
  fundedAtMs: number,
  durationSeconds: bigint,
  nowMs: number = Date.now(),
): bigint => principalRaw + computeAccruedInterest(principalRaw, interestRateBps, fundedAtMs, durationSeconds, nowMs);

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
  if (diff < 0) return `Overdue by ${Math.ceil(Math.abs(diff) / 86400000)}d`;
  const days = Math.ceil(diff / 86400000);
  if (days === 0) return 'Due today';
  return `Due in ${days}d`;
};
