/** Minimum number of closed trades in a category before its stats are trusted. */
export const MIN_TRADES_FOR_SIZING = 5;

export interface CategoryStats {
  /** Fraction of closed trades in this category that were profitable, 0-1. */
  winRate: number;
  /** Average win size divided by average loss size (both magnitudes), > 0. */
  avgWinLossRatio: number;
}

export interface ClosedTradeRecord {
  profitable: boolean;
  /** Raw native-unit profit/loss (lamports/wei), signed — negative on a loss. */
  profitAmount: string;
}

/**
 * Pure aggregation: derives per-category win rate + average win/loss ratio
 * from closed sell-trade rows. Returns null — "not enough data" — rather
 * than a number whenever the sample is too small or degenerate (all wins,
 * all losses, or a zero average loss), since a Kelly edge computed from a
 * one-sided or tiny sample is not a number worth sizing a real trade on.
 * Callers fall back to a flat conservative default size in that case.
 *
 * Win/loss magnitudes are aggregated in bigint (raw units) and only reduced
 * to a float ratio via basis-point scaling after the division, so the result
 * doesn't silently lose precision the way `Number(profitAmount)` would at
 * wei scale (same reasoning as `computeFeeRaw` in tp-sl.ts).
 */
export function computeCategoryStats(
  closedTrades: ClosedTradeRecord[],
  minSampleSize = MIN_TRADES_FOR_SIZING,
): CategoryStats | null {
  if (closedTrades.length < minSampleSize) return null;

  const wins = closedTrades.filter((t) => t.profitable);
  const losses = closedTrades.filter((t) => !t.profitable);
  if (wins.length === 0 || losses.length === 0) return null;

  const totalWinRaw = wins.reduce((sum, t) => sum + BigInt(t.profitAmount), 0n);
  const totalLossRaw = losses.reduce((sum, t) => sum - BigInt(t.profitAmount), 0n); // profitAmount is negative on a loss

  const avgWinRaw = totalWinRaw / BigInt(wins.length);
  const avgLossRaw = totalLossRaw / BigInt(losses.length);
  if (avgWinRaw <= 0n || avgLossRaw <= 0n) return null;

  const ratioBasisPoints = (avgWinRaw * 10_000n) / avgLossRaw;
  return {
    winRate: wins.length / closedTrades.length,
    avgWinLossRatio: Number(ratioBasisPoints) / 10_000,
  };
}

export interface SizingParams {
  /** Category stats, or null when there isn't enough closed-trade history yet. */
  stats: CategoryStats | null;
  /** The wallet's current uninvested native-unit balance. */
  availableBalanceRaw: bigint;
  /** Flat conservative size to fall back to when `stats` is null (typically the wallet's configured tradeSizeNative). */
  fallbackSizeRaw: bigint;
  /** Fraction of full Kelly to actually risk, e.g. 0.25 for quarter-Kelly. */
  kellyFraction: number;
  /** Hard per-trade cap, as a fraction of `availableBalanceRaw`. */
  maxPositionPct: number;
  /** Ceiling coming from the portfolio exposure cap (see exposure.ts's maxAdditionalExposureRaw). */
  maxAdditionalExposureRaw: bigint;
}

export interface SizingResult {
  sizeRaw: bigint;
  reason: string;
}

function pctOfRaw(amountRaw: bigint, fraction: number): bigint {
  const basisPoints = BigInt(Math.round(Math.max(0, fraction) * 10_000));
  return (amountRaw * basisPoints) / 10_000n;
}

function min(...values: bigint[]): bigint {
  return values.reduce((a, b) => (a < b ? a : b));
}

/**
 * Pure position-sizing decision. Given per-category historical performance,
 * computes a fractional-Kelly position size, then caps it at both the hard
 * max-per-trade Setting and whatever room the portfolio exposure cap leaves
 * (see exposure.ts) — whichever is smaller. Zero I/O; callers fetch/derive
 * `stats`, `availableBalanceRaw`, and `maxAdditionalExposureRaw` first.
 *
 * A `sizeRaw` of 0n means "don't open this position" — either there's no
 * room left under the caps, or the category has negative expectancy (the
 * mechanical Kelly formula, f* = winRate - (1 - winRate) / avgWinLossRatio,
 * comes out at or below zero).
 */
export function computePositionSize(params: SizingParams): SizingResult {
  const { stats, availableBalanceRaw, fallbackSizeRaw, kellyFraction, maxPositionPct, maxAdditionalExposureRaw } =
    params;

  if (availableBalanceRaw <= 0n) {
    return { sizeRaw: 0n, reason: "No available balance to size a position from" };
  }

  const ceilingRaw = min(pctOfRaw(availableBalanceRaw, maxPositionPct), maxAdditionalExposureRaw);
  if (ceilingRaw <= 0n) {
    return { sizeRaw: 0n, reason: "No room left under the max-per-trade cap or the portfolio exposure cap" };
  }

  if (!stats) {
    return {
      sizeRaw: min(fallbackSizeRaw, ceilingRaw),
      reason: "Not enough closed-trade history for this category yet — using the flat conservative default size",
    };
  }

  const kellyEdge = stats.winRate - (1 - stats.winRate) / stats.avgWinLossRatio;
  if (kellyEdge <= 0) {
    return { sizeRaw: 0n, reason: "Negative expectancy for this category — rejecting the trade" };
  }

  const kellySizeRaw = pctOfRaw(availableBalanceRaw, kellyFraction * kellyEdge);
  return {
    sizeRaw: min(kellySizeRaw, ceilingRaw),
    reason: `Fractional Kelly sizing (${(kellyFraction * 100).toFixed(0)}% of a ${(kellyEdge * 100).toFixed(1)}% edge)`,
  };
}
