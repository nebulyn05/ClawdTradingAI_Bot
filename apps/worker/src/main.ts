import { createServer } from "node:http";
import {
  eventBus,
  loadConfig,
  createLogger,
  startPublishingToRedis,
  getBooleanSetting,
  startKeepAlive,
  type Chain,
  type SignalSource,
  type NewPairEvent,
} from "@clawd/core";
import { getDb } from "@clawd/db";
import { startSniper } from "@clawd/sniper";
import { startScout, startKolTracking } from "@clawd/scout";
import { startArbiter } from "@clawd/arbiter";
import { startResearchCollector, startSolanaMarketDataCollector } from "@clawd/research";
import { getOrScreenToken, startDriftDetection } from "@clawd/guard";
import {
  openPosition,
  startPositionMonitor,
  startAiTpSlReview,
  startRuleEngine,
  startDrawdownCheck,
} from "@clawd/router";

const log = createLogger("worker:main");

function startHealthServer(): () => void {
  const port = Number(process.env.PORT ?? 10000);
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        service: "clawd-research-worker",
        tradingMode: process.env.TRADING_MODE ?? "paper",
      }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, "0.0.0.0");
  log.info({ port }, "Worker health server listening");
  return () => server.close();
}


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
  const stopHealthServer = startHealthServer();
  const researchOnly = process.env.RESEARCH_ONLY === "true";

  if (researchOnly) {
    log.info("Starting Solana research/paper-trading worker (research-only mode)");

    if (process.env.DB_DIAGNOSTICS === "true") {
      try {
        const { execFile } = await import("node:child_process");
        await new Promise<void>((resolve) => {
          execFile("node", ["scripts/research-status.mjs"], { env: process.env }, (error, stdout, stderr) => {
            if (stdout) log.info({ output: stdout.trim() }, "Research database diagnostics");
            if (stderr) log.warn({ output: stderr.trim() }, "Research database diagnostics stderr");
            if (error) log.warn({ err: error.message }, "Research database diagnostics failed");
            resolve();
          });
        });
      } catch (err) {
        log.warn({ err }, "Unable to run research database diagnostics");
      }
    }

    // Research mode deliberately excludes Scout, Arbiter, Router, position
    // monitoring, rule engine and Redis event publishing. This prevents the
    // research environment from invoking unrelated multi-chain infrastructure
    // or any real execution path.
    const stopResearch = startResearchCollector();
    const stopSolanaMarketData = startSolanaMarketDataCollector();
    const stopSniper = startSniper(["solana"]);

    const onResearchCandidate = async (pair: NewPairEvent) => {
      if (!pair || pair.chain !== "solana") return;
      await getOrScreenToken("solana", pair.tokenAddress).catch((err) => {
        log.warn({ err, tokenAddress: pair.tokenAddress }, "Research Guard screening failed");
      });
    };
    const stopResearchGuard = eventBus.on("sniper.newPair", (pair) => {
      void onResearchCandidate(pair);
    });

    const shutdownResearch = () => {
      log.info("Shutting down research worker...");
      stopResearchGuard();
      stopResearch();
      stopSolanaMarketData();
      stopSniper();
      stopHealthServer();
      process.exit(0);
    };
    process.once("SIGINT", shutdownResearch);
    process.once("SIGTERM", shutdownResearch);
    return;
  }

  log.info("Starting Clawd Agents worker (Sniper/Scout -> Guard -> Router, Arbiter detection)");

  const adminUrl = process.env.RENDER_ADMIN_URL;
  const websiteUrl = process.env.RENDER_WEBSITE_URL;
  const keepAliveUrls = [adminUrl, websiteUrl].filter((u): u is string => Boolean(u));
  if (keepAliveUrls.length > 0) {
    startKeepAlive({
      urls: keepAliveUrls.map((u) => `${u}/api/health`),
      intervalMs: 10 * 60 * 1000,
      verbose: false,
    });
  } else {
    log.info("No RENDER_ADMIN_URL/RENDER_WEBSITE_URL set — keep-alive disabled");
  }

  wireEventBus();
  const stopResearch = startResearchCollector();
  const stopSolanaMarketData = startSolanaMarketDataCollector();
  const stopSniper = startSniper();
  const stopScout = await startScout();
  const stopKolTracking = startKolTracking();
  const stopArbiter = startArbiter(cfg.ARBITER_SCAN_INTERVAL_MS);
  const stopMonitor = startPositionMonitor(cfg.POSITION_MONITOR_INTERVAL_MS);
  const stopAiTpSl = startAiTpSlReview(cfg.AI_TP_SL_REVIEW_INTERVAL_MS);
  const stopRuleEngine = startRuleEngine(cfg.RULE_ENGINE_INTERVAL_MS);
  const stopDriftDetection = startDriftDetection(cfg.GUARD_DRIFT_CHECK_INTERVAL_MS);
  const stopDrawdownCheck = startDrawdownCheck(cfg.DRAWDOWN_CHECK_INTERVAL_MS);
  const stopPublishing = startPublishingToRedis([
    "router.positionOpened",
    "router.positionClosed",
    "guard.rejected",
    "router.exposureCapRejected",
    "admin.alert",
  ]);

  const shutdown = () => {
    log.info("Shutting down worker...");
    stopResearch();
    stopSolanaMarketData();
    stopSniper();
    stopScout();
    stopKolTracking();
    stopArbiter();
    stopMonitor();
    stopAiTpSl();
    stopRuleEngine();
    stopDriftDetection();
    stopDrawdownCheck();
    stopPublishing();
    stopHealthServer();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
main().catch((err) => {
  console.error("Fatal error starting worker:", err);
  process.exit(1);
});
