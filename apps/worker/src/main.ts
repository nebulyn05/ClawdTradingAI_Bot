import { eventBus, loadConfig, createLogger } from "@clawd/core";
import { getDb } from "@clawd/db";
import { startSniper } from "@clawd/sniper";
import { getOrScreenToken } from "@clawd/guard";
import { openPosition, startPositionMonitor } from "@clawd/router";

const log = createLogger("worker:main");

function wireSniperToGuardAndRouter(): void {
  eventBus.on("sniper.newPair", (pair) => {
    void (async () => {
      log.info({ chain: pair.chain, tokenAddress: pair.tokenAddress }, "Screening new pair");
      const result = await getOrScreenToken(pair.chain, pair.tokenAddress).catch((err) => {
        log.warn({ err, pair }, "Guard screening failed");
        return null;
      });
      if (!result || !result.passed) return;

      const activeWallets = await getDb().wallet.findMany({
        where: { chain: pair.chain, active: true },
      });
      for (const wallet of activeWallets) {
        openPosition(wallet.userId, pair.chain, pair.tokenAddress, "sniper").catch((err) =>
          log.error({ err, userId: wallet.userId, pair }, "Failed to open position"),
        );
      }
    })();
  });
}

async function main() {
  const cfg = loadConfig();
  log.info("Starting Clawd Agents worker (Sniper -> Guard -> Router pipeline)");

  wireSniperToGuardAndRouter();
  const stopSniper = startSniper();
  const stopMonitor = startPositionMonitor(cfg.POSITION_MONITOR_INTERVAL_MS);

  const shutdown = () => {
    log.info("Shutting down worker...");
    stopSniper();
    stopMonitor();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error starting worker:", err);
  process.exit(1);
});
