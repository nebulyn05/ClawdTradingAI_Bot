export interface ExposureCheckResult {
  approved: boolean;
  reason?: string;
}

/**
 * Pure portfolio-exposure check: given the current native-unit value of every
 * open position this user holds on this chain, their available (uninvested)
 * native balance, and the size of a proposed new position, rejects the trade
 * if total exposure (existing positions + the proposed one) would exceed
 * `maxExposurePct` of the user's total portfolio value on this chain
 * (existing position value + uninvested balance — the swap itself doesn't
 * change that total, it only moves value from balance into a position).
 *
 * Zero I/O — callers fetch position values (re-quoted, like monitor.ts) and
 * wallet balance first.
 */
export function checkPortfolioExposure(
  openPositionValuesRaw: bigint[],
  proposedSizeRaw: bigint,
  walletBalanceRaw: bigint,
  maxExposurePct: number,
): ExposureCheckResult {
  const currentExposureRaw = openPositionValuesRaw.reduce((sum, v) => sum + v, 0n);
  const totalPortfolioRaw = currentExposureRaw + walletBalanceRaw;

  if (totalPortfolioRaw <= 0n) {
    return { approved: false, reason: "Cannot evaluate portfolio exposure — total portfolio value is zero" };
  }

  const projectedExposureRaw = currentExposureRaw + proposedSizeRaw;
  const maxExposureRaw = (totalPortfolioRaw * BigInt(Math.round(maxExposurePct * 10_000))) / 10_000n;

  if (projectedExposureRaw > maxExposureRaw) {
    const projectedPct = (Number(projectedExposureRaw) / Number(totalPortfolioRaw)) * 100;
    return {
      approved: false,
      reason:
        `New position would bring total exposure to ${projectedPct.toFixed(1)}% of portfolio value, ` +
        `above the ${(maxExposurePct * 100).toFixed(0)}% cap`,
    };
  }

  return { approved: true };
}

/**
 * How much additional native-unit exposure this user has room for before
 * hitting `maxExposurePct`, given the same inputs as `checkPortfolioExposure`.
 * Used by sizing.ts to cap a Kelly-derived position size at what the
 * exposure cap would allow, rather than computing a size and then finding
 * out it's rejected. Returns 0 if there's no room left (or none to begin
 * with, e.g. a zero-value portfolio).
 */
export function maxAdditionalExposureRaw(
  openPositionValuesRaw: bigint[],
  walletBalanceRaw: bigint,
  maxExposurePct: number,
): bigint {
  const currentExposureRaw = openPositionValuesRaw.reduce((sum, v) => sum + v, 0n);
  const totalPortfolioRaw = currentExposureRaw + walletBalanceRaw;
  if (totalPortfolioRaw <= 0n) return 0n;

  const maxExposureRaw = (totalPortfolioRaw * BigInt(Math.round(maxExposurePct * 10_000))) / 10_000n;
  const remainingRaw = maxExposureRaw - currentExposureRaw;
  return remainingRaw > 0n ? remainingRaw : 0n;
}
