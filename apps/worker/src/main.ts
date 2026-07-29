import {
  eventBus,
  loadConfig,
  createLogger,
  startPublishingToRedis,
  getBooleanSetting,
  type Chain,
  type SignalSource,
} from "@clawd/core";
import { getDb } from "@clawd/db";
import { startSniper } from "@clawd/sniper";
import { startScout, startKolTracking } from "@clawd/scout";
import { startArbiter } from "@clawd/arbiter";
import { getOrScreenToken } from "@clawd/guard";
import { openPosition, startPositionMonitor, startAiTpSlReview, startRuleEngine } from "@clawd/router";

const log = createLogger("worker:main");

/** Shared Guard -> Router path for Sniper and Scout signals. */
async function handleTradeCandidate(chain: Chain, tokenAddress: string, source: SignalSource) {
  // Live on/off switch from the admin dashboard — checked per-candidate
  // rather than tearing down the underlying subscription, since that's
  // cheap and the subscription itself is expensive to restart.
  const settingKey = source === "sniper" ? "SNIPER_ENABLED" : "SCOUT_ENABLED";
  if (!(await getBooleanSetting(settingKey, true))) return;

  log.info({ chain, tokenAddress, source }, "Screening candidate");
  const result = await getOrScreenToken(chain, tokenAddress).catch((err) => {
    log.warn({ err, chain, tokenAddress }, "Guard screening failed");
    return null;
  });
  if (!result || !result.passed) return;

  const activeWallets = await getDb().wallet.findMany({ where: { chain, active: true } });
  for (const wallet of activeWallets) {
    openPosition(wallet.userId, chain, tokenAddress, source).catch((err) =>
      log.error({ err, userId: wallet.userId, chain, tokenAddress }, "Failed to open position"),
    );
  }
}

function wireEventBus(): void {
  eventBus.on("sniper.newPair", (pair) => {
    void handleTradeCandidate(pair.chain, pair.tokenAddress, "sniper");
  });
  eventBus.on("scout.walletActivity", (activity) => {
    void handleTradeCandidate(activity.chain, activity.tokenAddress, "scout");
  });
  eventBus.on("scout.kolSignal", (signal) => {
    log.info(signal, "KOL signal");
    void handleTradeCandidate(signal.chain, signal.tokenAddress, "scout");
  });
  // Arbiter's cost estimate is a real LI.FI quote now (see scan.ts), and the
  // bridging primitive itself (@clawd/arbiter's executeCrossChainArbitrage,
  // EVM<->EVM only) is real too — but there's no orchestrator yet that picks
  // a user's wallets on both chains and runs the full buy -> bridge -> sell,
  // so opportunities are still logged rather than auto-traded.
  eventBus.on("arbiter.opportunity", async (opportunity) => {
    if (!(await getBooleanSetting("ARBITER_ENABLED", true))) return;
    log.info(opportunity, "Arbitrage opportunity (real cost estimate, not yet auto-traded)");
  });
}

async function main() {
  const cfg = loadConfig();
  log.info("Starting Clawd Agents worker (Sniper/Scout -> Guard -> Router, Arbiter detection)");

  wireEventBus();
  const stopSniper = startSniper();
  const stopScout = await startScout();
  const stopKolTracking = startKolTracking();
  const stopArbiter = startArbiter(cfg.ARBITER_SCAN_INTERVAL_MS);
  const stopMonitor = startPositionMonitor(cfg.POSITION_MONITOR_INTERVAL_MS);
  // No-op when AI_FEATURES_ENABLED is false — reviewTpSlWithAi short-circuits.
  const stopAiTpSl = startAiTpSlReview(cfg.AI_TP_SL_REVIEW_INTERVAL_MS);
  // Admin-dashboard-defined conditional triggers (e.g. "profit above X -> buy Y").
  const stopRuleEngine = startRuleEngine(cfg.RULE_ENGINE_INTERVAL_MS);
  // The bot runs in a separate process — bridge the events it needs for
  // user-facing notifications out over Redis (see @clawd/core/redis-bridge).
  const stopPublishing = startPublishingToRedis([
    "router.positionOpened",
    "router.positionClosed",
    "guard.rejected",
  ]);

  const shutdown = () => {
    log.info("Shutting down worker...");
    stopSniper();
    stopScout();
    stopKolTracking();
    stopArbiter();
    stopMonitor();
    stopAiTpSl();
    stopRuleEngine();
    stopPublishing();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error starting worker:", err);
  process.exit(1);
});
