/**
 * Pure helpers for deriving loan repayment figures.
 *
 * `loans.interestRate` is stored as the contract's ANNUAL interest rate in basis points
 * (e.g. 500 = 5% APR). These helpers approximate VouchVault's per-period simple-interest
 * accrual (no compounding, capped at the loan duration) for UI fallbacks only:
 *   accrued = principal * bps * elapsedPeriods / (10000 * PERIODS_PER_YEAR)
 * The authoritative figures should come from on-chain reads (e.g. getRepaymentDetails),
 * since on-chain accrual also depends on the outstanding principal after repayments and
 * the contract's cached accrual state (interestAccrued / lastAccrualAt).
 * All money math stays in bigint to avoid precision loss.
 */
const BPS_DENOMINATOR = 10000n;
// Accrual cadence: must match VouchVault (per-day periods, 365-day year).
const PERIODS_PER_YEAR = 365n; // days per year
const SECONDS_PER_PERIOD = 86400n; // 1 day

/** Whole days elapsed between funding and `now`, capped at the loan duration. */
const cappedElapsedPeriods = (fundedAtMs: number, durationSeconds: bigint, nowMs: number): bigint => {
  if (durationSeconds <= 0n) return 0n;
  const fundedAtSec = BigInt(Math.floor(fundedAtMs / 1000));
  const nowSec = BigInt(Math.floor(nowMs / 1000));
  const dueAtSec = fundedAtSec + durationSeconds;
  const cappedNowSec = nowSec < dueAtSec ? nowSec : dueAtSec;
  const elapsedSeconds = cappedNowSec > fundedAtSec ? cappedNowSec - fundedAtSec : 0n;
  return elapsedSeconds / SECONDS_PER_PERIOD;
};

/** Simple interest accrued so far (raw token units), capped at duration. */
export const computeAccruedInterest = (
  principalRaw: bigint,
  interestRateBps: bigint,
  fundedAtMs: number,
  durationSeconds: bigint,
  nowMs: number = Date.now(),
): bigint => {
  const periods = cappedElapsedPeriods(fundedAtMs, durationSeconds, nowMs);
  return (principalRaw * interestRateBps * periods) / (BPS_DENOMINATOR * PERIODS_PER_YEAR);
};

/** Total amount owed right now = principal + accrued interest. */
export const computeTotalDue = (
  principalRaw: bigint,
  interestRateBps: bigint,
  fundedAtMs: number,
  durationSeconds: bigint,
  nowMs: number = Date.now(),
): bigint => principalRaw + computeAccruedInterest(principalRaw, interestRateBps, fundedAtMs, durationSeconds, nowMs);

export type HealthFactorResult = {
  healthFactor: number;
  riskStatus: 'Safe' | 'Warning' | 'Liquidation Risk';
};

/**
 * Off-chain projection of the health factor at loan creation time.
 * Mirrors VouchVault.getHealthFactor: (collateral * (liquidationThreshold / 100)) / borrowed.
 * `liquidationThreshold` is expected to be a percentage in the 0–100 range (e.g. 80 for 80%).
 */
export const calculateHealthFactor = (
  collateralUsd: number,
  borrowedUsd: number,
  liquidationThreshold: number,
): HealthFactorResult | null => {
  if (borrowedUsd <= 0 || collateralUsd <= 0) return null;
  const healthFactor = (collateralUsd * (liquidationThreshold / 100)) / borrowedUsd;
  const riskStatus =
    healthFactor >= 1.5 ? 'Safe' : healthFactor >= 1.0 ? 'Warning' : 'Liquidation Risk';
  return { healthFactor, riskStatus };
};

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

/**
 * Parse a Postgres `interval` string into total seconds.
 * Handles textual parts ("30 days", "1 year 2 mons 3 days") and the
 * HH:MM:SS time portion, which may exceed 24h (e.g. "720:00:00").
 */
export const intervalToSeconds = (interval: string): number => {
  if (!interval) return 0;
  const text = interval.toLowerCase();
  const grab = (re: RegExp): number => {
    const m = text.match(re);
    return m ? parseFloat(m[1]) : 0;
  };
  let total = 0;
  total += grab(/(\d+)\s*year/) * 365 * 86400;
  total += grab(/(\d+)\s*mon/) * 30 * 86400;
  total += grab(/(\d+)\s*week/) * 7 * 86400;
  total += grab(/(\d+)\s*day/) * 86400;
  const time = text.match(/(\d+):(\d{2}):(\d{2})/);
  if (time) total += parseInt(time[1], 10) * 3600 + parseInt(time[2], 10) * 60 + parseInt(time[3], 10);
  return total;
};

/** Human-readable loan term label ("30d" / "12h" / "45m") from a Postgres interval. */
export const formatLoanTerm = (interval: string | null): string => {
  const secs = interval ? intervalToSeconds(interval) : 0;
  if (secs <= 0) return '—';
  const days = secs / 86400;
  if (days >= 1) return `${Number.isInteger(days) ? days : days.toFixed(1)}d`;
  const hours = secs / 3600;
  if (hours >= 1) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  return `${Math.max(1, Math.round(secs / 60))}m`;
};
