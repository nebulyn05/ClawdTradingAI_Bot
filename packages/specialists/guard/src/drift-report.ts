import { getDb } from "@clawd/db";
import { loadConfig, createLogger, getNumberSetting, eventBus } from "@clawd/core";
import {
  classifyOutcome,
  aggregateByVersion,
  splitRollingByVersion,
  detectDrift,
  type VersionAccuracy,
  type DriftAlert,
  type VersionedOutcomeRecord,
} from "./drift.js";

const log = createLogger("guard:drift-report");

/** Minimum closed positions in both the rolling window and the baseline before an alert is trusted. */
const MIN_SAMPLE_SIZE = 5;

export interface GuardDriftReport {
  byRuleVersion: VersionAccuracy[];
  byAiPromptVersion: VersionAccuracy[];
  ruleVersionAlerts: DriftAlert[];
  aiPromptVersionAlerts: DriftAlert[];
}

/**
 * Reads every closed position that Guard actually approved (i.e. every
 * closed Position — Guard rejections never become one), joins each to the
 * token's most recently cached SafetyCheck row for the ruleVersion /
 * aiPromptVersion that produced the approval, and classifies the closed
 * trade's real outcome (see drift.ts's GuardOutcome doc comment for the
 * "accepted-only, precision-style" caveat this implies).
 *
 * SafetyCheck only retains the latest screen per token, not a point-in-time
 * history — so a token re-screened after its position closed would show
 * its *current* ruleVersion/aiPromptVersion here, not necessarily the one
 * active at approval time. This holds in the common case (a token isn't
 * re-screened again after its only trade closes) but is a known
 * approximation, same as the backtest module's load-history.ts.
 */
export async function getGuardDriftReport(
  options: { rollingWindowSize?: number; alertThresholdPct?: number } = {},
): Promise<GuardDriftReport> {
  const cfg = loadConfig();
  const rollingWindowSize =
    options.rollingWindowSize ?? (await getNumberSetting("GUARD_DRIFT_ROLLING_WINDOW_SIZE", cfg.GUARD_DRIFT_ROLLING_WINDOW_SIZE));
  const alertThresholdPct =
    options.alertThresholdPct ?? (await getNumberSetting("GUARD_DRIFT_ALERT_THRESHOLD_PCT", cfg.GUARD_DRIFT_ALERT_THRESHOLD_PCT));

  const db = getDb();
  const positions = await db.position.findMany({
    where: { status: "closed", exitReason: { not: null } },
  });

  if (positions.length === 0) {
    return { byRuleVersion: [], byAiPromptVersion: [], ruleVersionAlerts: [], aiPromptVersionAlerts: [] };
  }

  const safetyChecks = await db.safetyCheck.findMany({
    where: { OR: positions.map((p) => ({ chain: p.chain, tokenAddress: p.tokenAddress })) },
  });
  const safetyByKey = new Map(safetyChecks.map((s) => [`${s.chain}:${s.tokenAddress}`, s]));

  const ruleRecords: VersionedOutcomeRecord[] = [];
  const aiRecords: VersionedOutcomeRecord[] = [];

  for (const position of positions) {
    if (!position.exitReason || !position.closedAt) continue;
    const safety = safetyByKey.get(`${position.chain}:${position.tokenAddress}`);
    if (!safety) continue;

    const outcome = classifyOutcome(position.exitReason);
    const closedAtMs = position.closedAt.getTime();

    ruleRecords.push({ version: safety.ruleVersion, outcome, closedAtMs });
    if (safety.aiPromptVersion) {
      aiRecords.push({ version: safety.aiPromptVersion, outcome, closedAtMs });
    }
  }

  const ruleSplit = splitRollingByVersion(ruleRecords, rollingWindowSize);
  const aiSplit = splitRollingByVersion(aiRecords, rollingWindowSize);

  const byRuleVersion = aggregateByVersion(ruleRecords);
  const byAiPromptVersion = aggregateByVersion(aiRecords);

  const ruleVersionAlerts = detectDrift(
    aggregateByVersion(ruleSplit.rolling),
    aggregateByVersion(ruleSplit.baseline),
    alertThresholdPct,
    MIN_SAMPLE_SIZE,
  );
  const aiPromptVersionAlerts = detectDrift(
    aggregateByVersion(aiSplit.rolling),
    aggregateByVersion(aiSplit.baseline),
    alertThresholdPct,
    MIN_SAMPLE_SIZE,
  );

  return { byRuleVersion, byAiPromptVersion, ruleVersionAlerts, aiPromptVersionAlerts };
}

function emitDriftAlert(kind: "rule version" | "AI prompt version", alert: DriftAlert): void {
  const message =
    `Guard accuracy drift on ${kind} "${alert.version}": rolling accuracy ` +
    `${(alert.rollingAccuracy * 100).toFixed(1)}% is ${(alert.dropPct * 100).toFixed(1)} points below its ` +
    `${(alert.baselineAccuracy * 100).toFixed(1)}% baseline.`;
  log.warn(alert, message);
  eventBus.emit("admin.alert", { source: "guard_drift", message });
}

async function checkGuardDrift(): Promise<void> {
  const report = await getGuardDriftReport();
  for (const alert of report.ruleVersionAlerts) emitDriftAlert("rule version", alert);
  for (const alert of report.aiPromptVersionAlerts) emitDriftAlert("AI prompt version", alert);
}

/** Starts a recurring Guard-drift check. Returns a function to stop it. */
export function startDriftDetection(intervalMs: number): () => void {
  const timer = setInterval(() => {
    checkGuardDrift().catch((err) => log.error({ err }, "Guard drift check failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
