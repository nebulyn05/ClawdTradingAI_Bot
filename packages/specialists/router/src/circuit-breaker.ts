export interface DrawdownResult {
  /** The highest cumulative realized P&L reached before the worst decline. */
  peakRaw: bigint;
  /** The cumulative realized P&L at the bottom of the worst decline. */
  troughRaw: bigint;
  /** Fraction of `peakRaw` lost at the trough, e.g. 0.3 = a 30% drawdown. */
  drawdownPct: number;
}

/**
 * Walks a chronologically-ordered list of signed raw realized-P&L deltas
 * (one per closed trade, native units) and finds the worst peak-to-trough
 * decline in the cumulative curve — the same peak/trough method the
 * backtest module's computeMaxDrawdownPct uses, but on real settled P&L
 * rather than a simulated equity curve, so the ratio is computed in bigint
 * basis points (like computeFeeRaw) rather than via `Number(bigint)`, since
 * this result gates a real trading-halt decision.
 *
 * If the window never reaches a positive cumulative P&L (pure losses from
 * the start), there's no meaningful peak to express a percentage against —
 * that state is itself the worst possible drawdown, so this returns 1 (or 0
 * if there were no losses at all, i.e. an empty or flat window).
 */
export function computeDrawdown(profitDeltasRaw: bigint[]): DrawdownResult {
  let cumulative = 0n;
  let peak = 0n;
  let maxDrawdownRaw = 0n;
  let peakAtMaxDrawdown = 0n;
  let troughAtMaxDrawdown = 0n;

  for (const delta of profitDeltasRaw) {
    cumulative += delta;
    if (cumulative > peak) peak = cumulative;

    const drawdownRaw = peak - cumulative;
    if (drawdownRaw > maxDrawdownRaw) {
      maxDrawdownRaw = drawdownRaw;
      peakAtMaxDrawdown = peak;
      troughAtMaxDrawdown = cumulative;
    }
  }

  return {
    peakRaw: peakAtMaxDrawdown,
    troughRaw: troughAtMaxDrawdown,
    drawdownPct: drawdownPctOf(maxDrawdownRaw, peakAtMaxDrawdown),
  };
}

/**
 * Isolated in its own function (rather than inlined into computeDrawdown's
 * loop scope) — a bundler-tracing issue observed with this exact shape
 * (a bigint divisor that started life as a `let x = 0n` mutated inside a
 * loop) caused @vercel/nft's static analysis to mis-evaluate the division
 * during `next build` and throw `RangeError: Division by zero`, even though
 * the call site never actually divides by zero at runtime. Passing the
 * divisor in as a plain parameter avoids that shape.
 */
function drawdownPctOf(maxDrawdownRaw: bigint, peakAtMaxDrawdown: bigint): number {
  if (peakAtMaxDrawdown <= 0n) return maxDrawdownRaw > 0n ? 1 : 0;
  const basisPoints = (maxDrawdownRaw * 10_000n) / peakAtMaxDrawdown;
  return Number(basisPoints) / 10_000;
}

/** Whether this drawdown is severe enough to pause new trades. */
export function shouldPauseTrading(drawdownPct: number, thresholdPct: number): boolean {
  return drawdownPct > thresholdPct;
}
