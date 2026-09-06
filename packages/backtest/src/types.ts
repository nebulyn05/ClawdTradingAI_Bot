import type { Chain, SignalSource } from "@clawd/core";

/**
 * One closed historical trade, reconstructed from Position/Trade rows — the
 * ground truth a backtest replays against (see load-history.ts).
 */
export interface HistoricalSignal {
  positionId: string;
  source: SignalSource;
  chain: Chain;
  tokenAddress: string;
  openedAt: Date;
  /**
   * Guard's most recently cached score/checks for this token (SafetyCheck),
   * used as a stand-in for "what Guard would have seen at signal time." The
   * schema only retains the latest Guard result per token, not a
   * point-in-time history of it (that's what item 4's drift-detection
   * columns are for) — so replaying a candidate Guard rule-set against this
   * is a documented approximation, not an exact historical replay. It holds
   * reasonably well for tokens whose liquidity/authority checks don't
   * change after launch, which is the common case.
   */
  guardScore: number | null;
  guardChecks: Record<string, boolean> | null;
  /** Fractional realized return on the actual historical trade, e.g. 0.5 = +50%. */
  returnPct: number;
  /** Raw native-unit profit/loss from the real trade (exact, signed) — ground truth for sizing replay's category stats. */
  profitAmountRaw: bigint;
  /** Raw native-unit amount actually spent entering this historical trade. */
  actualSizeRaw: bigint;
  profitable: boolean;
}

/** A candidate Guard rule-set to test against history instead of the live rules. */
export interface GuardCandidateConfig {
  /** Minimum score (0-100) required to "pass." Guard's live default is rules.ts's PASS_THRESHOLD (60). */
  passThreshold: number;
  /** Every named check must be `true` in the signal's guardChecks, if provided (e.g. ["notHoneypot"]). */
  requireChecks?: string[];
}

/** A candidate sizing config to test against history instead of the live Settings. */
export interface SizingCandidateConfig {
  kellyFraction: number;
  maxPositionPct: number;
  /**
   * Simulated starting bankroll (raw native units) every test-window trade
   * is sized against — a simplification. This replay sizes each trade
   * independently against this fixed bankroll; it doesn't model a
   * compounding balance or concurrent open positions' effect on the
   * portfolio-exposure cap from exposure.ts. Combine with a smaller
   * maxPositionPct if you want a rough stand-in for that.
   */
  startingBalanceRaw: bigint;
  /** Flat fallback size (as a fraction of startingBalanceRaw) used when a category has no trusted stats yet. Defaults to 0.05. */
  fallbackSizePct?: number;
  minSampleSize?: number;
}

/**
 * Out-of-sample split: category stats for sizing are derived only from
 * signals in [trainStart, trainEnd), then applied to signals in
 * [testStart, testEnd) — so a config can't be validated on the same trades
 * it was tuned on. Reported metrics only ever cover the test window.
 */
export interface BacktestSplit {
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
}

export interface BacktestConfig {
  /** Omit to skip Guard-filter replay entirely — every signal in the test window is "taken." */
  guard?: GuardCandidateConfig;
  /** Omit to size every taken trade at its full nominal (unweighted) return — a Guard-only backtest. */
  sizing?: SizingCandidateConfig;
  /** Omit to run the whole signal set as a single in-sample window (no train/test split). */
  split?: BacktestSplit;
}

export interface BacktestReport {
  /** Signals in the test window Guard was asked to evaluate. */
  tradesConsidered: number;
  /** Signals that passed the Guard filter (if any) and received a nonzero sizing weight. */
  tradesTaken: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  /** Simulated equity value after each taken trade, starting at 1.0 — handy for charting. */
  equityCurve: number[];
}
