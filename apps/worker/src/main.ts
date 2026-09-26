import {
  createLogger,
  loadConfig,
  startKeepAlive,
  stopKeepAlive,
  startPublishingToRedis,
} from "@clawd/core";
import {
  startPositionMonitor,
  startRuleEngine,
  startDrawdownCheck,
} from "@clawd/router";
import { createServer } from "node:http";

const log = createLogger("worker:main");

function startHealthServer() {
  const port = Number(process.env.PORT) || 10000;

  const server = createServer((req, res) => {
    if (req.url === "/api/health" || req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "worker" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    log.info(`Worker health server listening on port ${port}`);
  });

  return () => {
    server.close(() => log.info("Worker health server stopped"));
  };
}

async function main() {
  const cfg = loadConfig();

  log.info(
    "Starting Clawd trading worker (automation rules + position/risk management)",
  );

  const stopHealthServer = startHealthServer();

  const keepAliveUrls = [process.env.RENDER_ADMIN_URL, process.env.RENDER_WEBSITE_URL]
    .filter((url): url is string => Boolean(url));

  if (keepAliveUrls.length > 0) {
    startKeepAlive({
      urls: keepAliveUrls.map((url) => `${url}/api/health`),
      intervalMs: 10 * 60 * 1000,
      verbose: false,
    });
  }

  // The worker deliberately does not start Sniper, Scout, KOL tracking or
  // Arbiter. Those signal-discovery systems are disabled for this phase.
  // Trades are initiated by Admin rules and manual Admin actions through the
  // shared Router, while this worker owns continuous execution/risk loops.
  const stopRuleEngine = startRuleEngine(cfg.RULE_ENGINE_INTERVAL_MS);
  const stopPositionMonitor = startPositionMonitor(cfg.POSITION_MONITOR_INTERVAL_MS);
  const stopDrawdownCheck = startDrawdownCheck(cfg.DRAWDOWN_CHECK_INTERVAL_MS);

  const stopPublishing = startPublishingToRedis([
    "router.positionOpened",
    "router.positionClosed",
    "router.exposureCapRejected",
    "admin.alert",
  ]);

  const shutdown = () => {
    log.info("Shutting down trading worker...");
    stopRuleEngine();
    stopPositionMonitor();
    stopDrawdownCheck();
    stopPublishing();
    stopKeepAlive();
    stopHealthServer();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error starting trading worker:", err);
  process.exit(1);
});
