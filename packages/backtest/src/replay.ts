import {
  buildEquityCurve,
  computeAvgLossPct,
  computeAvgWinPct,
  computeMaxDrawdownPct,
  computeTotalReturnPct,
  computeWinRate,
} from "./metrics.js";
import { guardWouldPass } from "./rule-filter.js";
import { replaySizing } from "./sizing-replay.js";
import type { BacktestConfig, BacktestReport, HistoricalSignal } from "./types.js";

function inWindow(date: Date, start: Date, end: Date): boolean {
  return date >= start && date < end;
}

/**
 * Replays `signals` (real closed-trade ground truth — see load-history.ts)
 * against a candidate Guard rule-set and/or sizing config, and reports the
 * resulting win rate / avg win-loss / max drawdown / total return. Pure —
 * no DB access, no chain calls, nothing here executes a real trade.
 *
 * With no `config.guard`, every signal in the test window is "taken." With
 * no `config.sizing`, every taken trade counts at its full nominal return
 * (a Guard-only backtest). With no `config.split`, the whole signal set is
 * treated as a single in-sample test window (fine for eyeballing a Guard
 * threshold change, but a sizing config validated this way is being judged
 * on the same trades it would be tuned against — pass `split` to avoid that).
 */
export function runBacktest(signals: HistoricalSignal[], config: BacktestConfig): BacktestReport {
  const sorted = [...signals].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

  const split = config.split;
  const trainSignals = split ? sorted.filter((s) => inWindow(s.openedAt, split.trainStart, split.trainEnd)) : [];
  const testSignals = split ? sorted.filter((s) => inWindow(s.openedAt, split.testStart, split.testEnd)) : sorted;

  const guardConfig = config.guard;
  const taken = guardConfig
    ? testSignals.filter((s) => guardWouldPass(s.guardScore, s.guardChecks, guardConfig))
    : testSignals;

  const sizingConfig = config.sizing;
  const weights = sizingConfig ? replaySizing(trainSignals, taken, sizingConfig) : taken.map(() => 1);

  const weightedReturns = taken
    .map((signal, i) => ({ returnPct: signal.returnPct, weight: weights[i] ?? 0 }))
    .filter((t) => t.weight > 0)
    .map((t) => t.returnPct * t.weight);

  const equityCurve = buildEquityCurve(weightedReturns);

  return {
    tradesConsidered: testSignals.length,
    tradesTaken: weightedReturns.length,
    winRate: computeWinRate(weightedReturns),
    avgWinPct: computeAvgWinPct(weightedReturns),
    avgLossPct: computeAvgLossPct(weightedReturns),
    maxDrawdownPct: computeMaxDrawdownPct(equityCurve),
    totalReturnPct: computeTotalReturnPct(equityCurve),
    equityCurve,
  };
}
