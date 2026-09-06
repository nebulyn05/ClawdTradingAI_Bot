import { computeCategoryStats, computePositionSize, type CategoryStats, type ClosedTradeRecord } from "@clawd/router";
import type { HistoricalSignal, SizingCandidateConfig } from "./types.js";

const DEFAULT_FALLBACK_SIZE_PCT = 0.05;

/**
 * Reuses @clawd/router's own Kelly-sizing engine rather than reimplementing
 * it, so a backtest can never drift from what Router would actually do with
 * the same config.
 *
 * For each category (signal source) present in `testSignals`, category
 * stats are derived ONLY from `trainSignals` — frozen before the test
 * window starts — then every test-window trade in that category is sized
 * against those same frozen stats. That's what keeps this out-of-sample: a
 * sizing config tuned to look good on a given set of trades can't also be
 * validated against that same set, because the stats it's judged against
 * were computed from a disjoint, earlier window.
 *
 * Returns, per `testSignals` entry (same order), the fraction of
 * `startingBalanceRaw` actually sized into that trade — 0 for a trade the
 * sizing engine rejected (no room under the caps, or negative expectancy).
 */
export function replaySizing(
  trainSignals: HistoricalSignal[],
  testSignals: HistoricalSignal[],
  config: SizingCandidateConfig,
): number[] {
  const { startingBalanceRaw, kellyFraction, maxPositionPct, minSampleSize } = config;
  const fallbackSizeRaw = pctOfRaw(startingBalanceRaw, config.fallbackSizePct ?? DEFAULT_FALLBACK_SIZE_PCT);

  const statsByCategory = new Map<string, CategoryStats | null>();
  for (const category of new Set(testSignals.map((s) => s.source))) {
    const closedTrades: ClosedTradeRecord[] = trainSignals
      .filter((s) => s.source === category)
      .map((s) => ({ profitable: s.profitable, profitAmount: s.profitAmountRaw.toString() }));
    statsByCategory.set(category, computeCategoryStats(closedTrades, minSampleSize));
  }

  if (startingBalanceRaw <= 0n) return testSignals.map(() => 0);

  return testSignals.map((signal) => {
    const sizing = computePositionSize({
      stats: statsByCategory.get(signal.source) ?? null,
      availableBalanceRaw: startingBalanceRaw,
      fallbackSizeRaw,
      kellyFraction,
      maxPositionPct,
      // This replay sizes each trade independently against the full simulated
      // bankroll — it doesn't model concurrent open positions, so there's no
      // separate portfolio-exposure ceiling to apply here (see SizingCandidateConfig's doc comment).
      maxAdditionalExposureRaw: startingBalanceRaw,
    });
    const weightBasisPoints = (sizing.sizeRaw * 10_000n) / startingBalanceRaw;
    return Number(weightBasisPoints) / 10_000;
  });
}

function pctOfRaw(amountRaw: bigint, fraction: number): bigint {
  const basisPoints = BigInt(Math.round(Math.max(0, fraction) * 10_000));
  return (amountRaw * basisPoints) / 10_000n;
}
