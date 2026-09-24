import { createServer } from "node:http";
import { eventBus, createLogger } from "@clawd/core";
import { startSniper } from "@clawd/sniper";
import { getOrScreenToken } from "@clawd/guard";
import { startResearchCollector, startSolanaMarketDataCollector } from "@clawd/research";
import type { NewPairEvent } from "@clawd/core";

const log = createLogger("research-worker");

function startHealthServer(): () => void {
  const port = Number(process.env.PORT ?? 10000);
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        service: "clawd-research-worker",
        mode: "paper-research",
        tradingMode: process.env.TRADING_MODE ?? "paper",
        realTradingEnabled: false,
      }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, "0.0.0.0");
  return () => server.close();
}

async function main() {
  process.env.TRADING_MODE = "paper";
  process.env.REAL_TRADING_ENABLED = "false";

  const stopHealth = startHealthServer();
  const stopResearch = startResearchCollector();
  const stopMarketData = startSolanaMarketDataCollector();
  const stopSniper = startSniper(["solana"]);

  const stopGuardScreening = eventBus.on("sniper.newPair", (pair: NewPairEvent) => {
    if (pair.chain !== "solana") return;
    void getOrScreenToken("solana", pair.tokenAddress).catch((err) => {
      log.warn({ err, tokenAddress: pair.tokenAddress }, "Research Guard screening failed");
    });
  });

  log.info("Research-only paper-trading worker started");

  const shutdown = () => {
    log.info("Shutting down research worker");
    stopGuardScreening();
    stopResearch();
    stopMarketData();
    stopSniper();
    stopHealth();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal research worker error:", err);
  process.exit(1);
});
