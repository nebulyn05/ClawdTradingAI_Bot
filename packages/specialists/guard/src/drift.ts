import type { ExitReason } from "@clawd/core";

/**
 * How a closed position's real-world outcome is read back onto the Guard
 * decision that let it be traded in the first place. Guard rejections never
 * become positions (no price history to check a false-rejection against),
 * so this — and everything else in this file — only measures accuracy on
 * the *accepted* population: a precision-style metric ("of the tokens Guard
 * let through, how often did one turn out to be a rug?"), not full accuracy.
 *
 * - `guard_exit`: Guard itself later caught the token failing re-screening —
 *   the clearest retroactive signal the original approval was wrong.
 * - `take_profit`: the trade hit its profit target — Guard's call held up.
 * - `stop_loss` / `manual`: ordinary trading variance, not evidence one way
 *   or the other about the safety screen itself.
 */
export type GuardOutcome = "rugged" | "performed_well" | "neutral";

export function classifyOutcome(exitReason: ExitReason): GuardOutcome {
  if (exitReason === "guard_exit") return "rugged";
  if (exitReason === "take_profit") return "performed_well";
  return "neutral";
}

export interface VersionAccuracy {
  version: string;
  total: number;
  rugged: number;
  performedWell: number;
  neutral: number;
  /** (total - rugged) / total — the fraction of approvals that did NOT turn out to be a rug. */
  accuracy: number;
}

/** Pure aggregation: buckets classified outcomes by version and computes each bucket's accuracy. */
export function aggregateByVersion(records: { version: string; outcome: GuardOutcome }[]): VersionAccuracy[] {
  const byVersion = new Map<string, { total: number; rugged: number; performedWell: number; neutral: number }>();

  for (const r of records) {
    const bucket = byVersion.get(r.version) ?? { total: 0, rugged: 0, performedWell: 0, neutral: 0 };
    bucket.total += 1;
    if (r.outcome === "rugged") bucket.rugged += 1;
    else if (r.outcome === "performed_well") bucket.performedWell += 1;
    else bucket.neutral += 1;
    byVersion.set(r.version, bucket);
  }

  return Array.from(byVersion.entries()).map(([version, b]) => ({
    version,
    total: b.total,
    rugged: b.rugged,
    performedWell: b.performedWell,
    neutral: b.neutral,
    accuracy: b.total === 0 ? 0 : (b.total - b.rugged) / b.total,
  }));
}

export interface VersionedOutcomeRecord {
  version: string;
  outcome: GuardOutcome;
  /** Epoch milliseconds — plain number so this stays a pure, easily-testable function (no Date identity concerns). */
  closedAtMs: number;
}

/**
 * Splits records into a rolling (most-recent `rollingWindowSize`) and
 * baseline (everything older) set, independently per version — so two
 * versions that were active over different date ranges each get their own
 * fair rolling/baseline split instead of one global cutoff misassigning
 * records between them.
 */
export function splitRollingByVersion(
  records: VersionedOutcomeRecord[],
  rollingWindowSize: number,
): { rolling: VersionedOutcomeRecord[]; baseline: VersionedOutcomeRecord[] } {
  const byVersion = new Map<string, VersionedOutcomeRecord[]>();
  for (const r of records) {
    const list = byVersion.get(r.version) ?? [];
    list.push(r);
    byVersion.set(r.version, list);
  }

  const rolling: VersionedOutcomeRecord[] = [];
  const baseline: VersionedOutcomeRecord[] = [];
  for (const list of byVersion.values()) {
    const sorted = [...list].sort((a, b) => a.closedAtMs - b.closedAtMs);
    const splitAt = Math.max(0, sorted.length - rollingWindowSize);
    baseline.push(...sorted.slice(0, splitAt));
    rolling.push(...sorted.slice(splitAt));
  }

  return { rolling, baseline };
}

export interface DriftAlert {
  version: string;
  rollingAccuracy: number;
  baselineAccuracy: number;
  /** Percentage points the rolling accuracy has dropped below baseline (positive = worse). */
  dropPct: number;
}

/**
 * Flags any version whose rolling-window accuracy has dropped more than
 * `thresholdPct` (a fraction, e.g. 0.15 = 15 percentage points) below its
 * own baseline. Versions without at least `minSampleSize` closed positions
 * in both the rolling window and the baseline are skipped — not enough
 * history to distinguish real drift from noise.
 */
export function detectDrift(
  rolling: VersionAccuracy[],
  baseline: VersionAccuracy[],
  thresholdPct: number,
  minSampleSize = 5,
): DriftAlert[] {
  const baselineByVersion = new Map(baseline.map((b) => [b.version, b]));
  const alerts: DriftAlert[] = [];

  for (const r of rolling) {
    if (r.total < minSampleSize) continue;
    const base = baselineByVersion.get(r.version);
    if (!base || base.total < minSampleSize) continue;

    const dropPct = base.accuracy - r.accuracy;
    if (dropPct > thresholdPct) {
      alerts.push({ version: r.version, rollingAccuracy: r.accuracy, baselineAccuracy: base.accuracy, dropPct });
    }
  }

  return alerts;
}
