import {
  eventBus,
  loadConfig,
  createLogger,
  startPublishingToRedis,
  type Chain,
  type SignalSource,
} from "@clawd/core";
import { getDb } from "@clawd/db";
import { startSniper } from "@clawd/sniper";
import { startScout, startKolTracking } from "@clawd/scout";
import { startArbiter } from "@clawd/arbiter";
import { getOrScreenToken } from "@clawd/guard";
import { openPosition, startPositionMonitor, startAiTpSlReview } from "@clawd/router";

const log = createLogger("worker:main");

/** Shared Guard -> Router path for both Sniper and Scout signals. */
async function handleTradeCandidate(chain: Chain, tokenAddress: string, source: SignalSource) {
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
  // Arbiter is detection-only for now — cross-chain execution (buy + bridge +
  // sell) isn't built yet, so opportunities are logged, not auto-traded.
  eventBus.on("arbiter.opportunity", (opportunity) => {
    log.info(opportunity, "Arbitrage opportunity (detection only, not auto-traded)");
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
