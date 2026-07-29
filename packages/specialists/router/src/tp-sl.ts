import type { ExitReason } from "@clawd/core";

/** Take-profit price target, `pct` above `entryPrice` (0.5 = +50%). */
export function computeTakeProfitPrice(entryPrice: number, pct: number): number {
  return entryPrice * (1 + pct);
}

/** Stop-loss price target, `pct` below `entryPrice` (0.2 = -20%). */
export function computeStopLossPrice(entryPrice: number, pct: number): number {
  return entryPrice * (1 - pct);
}

/** Returns which exit condition (if any) `currentPrice` has triggered. Take-profit wins ties. */
export function checkExitTrigger(
  currentPrice: number,
  takeProfitPrice: number,
  stopLossPrice: number,
): ExitReason | null {
  if (currentPrice >= takeProfitPrice) return "take_profit";
  if (currentPrice <= stopLossPrice) return "stop_loss";
  return null;
}

/** Fee owed on a closed trade: `feeRate` of profit, or 0 if the trade wasn't profitable. */
export function computeFee(profitNative: number, feeRate: number): number {
  return profitNative > 0 ? profitNative * feeRate : 0;
}

/**
 * Bigint-safe version of computeFee for raw native units (lamports/wei),
 * which can exceed Number's safe-integer range. `feeRate` is converted to
 * basis points internally so the multiplication stays exact.
 */
export function computeFeeRaw(profitRaw: bigint, feeRate: number): bigint {
  if (profitRaw <= 0n) return 0n;
  const basisPoints = BigInt(Math.round(feeRate * 10_000));
  return (profitRaw * basisPoints) / 10_000n;
}
