/**
 * Pure backtest statistics over an ordered list of fractional per-trade
 * returns (0.5 = +50%) and the equity curve built from them. Descriptive
 * statistics for a report, not funds-movement accounting — floats are the
 * right tool here, unlike the raw-bigint math tp-sl.ts/sizing.ts use for
 * actual fee/profit settlement.
 */

/** Builds a sequential equity curve from ordered per-trade returns, starting at `startingEquity` (default 1.0). */
export function buildEquityCurve(returnsPct: number[], startingEquity = 1): number[] {
  const curve: number[] = [startingEquity];
  for (const r of returnsPct) {
    const previous = curve[curve.length - 1] ?? startingEquity;
    curve.push(previous * (1 + r));
  }
  return curve;
}

export function computeWinRate(returnsPct: number[]): number {
  return returnsPct.length === 0 ? 0 : returnsPct.filter((r) => r > 0).length / returnsPct.length;
}

export function computeAvgWinPct(returnsPct: number[]): number {
  const wins = returnsPct.filter((r) => r > 0);
  return wins.length === 0 ? 0 : wins.reduce((a, b) => a + b, 0) / wins.length;
}

/** Average of the losing returns — a negative number (e.g. -0.2 for an average 20% loss), or 0 if there were none. */
export function computeAvgLossPct(returnsPct: number[]): number {
  const losses = returnsPct.filter((r) => r < 0);
  return losses.length === 0 ? 0 : losses.reduce((a, b) => a + b, 0) / losses.length;
}

/** Largest peak-to-trough decline over the equity curve, as a positive fraction (0.3 = a 30% drawdown). */
export function computeMaxDrawdownPct(equityCurve: number[]): number {
  const [first = 0] = equityCurve;
  let peak = first;
  let maxDrawdown = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }
  return maxDrawdown;
}

/** Overall return from the first to the last point on the equity curve. */
export function computeTotalReturnPct(equityCurve: number[]): number {
  const [start] = equityCurve;
  const end = equityCurve[equityCurve.length - 1];
  if (start === undefined || end === undefined || start === 0) return 0;
  return (end - start) / start;
}
