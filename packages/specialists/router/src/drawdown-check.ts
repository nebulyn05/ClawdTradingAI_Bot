import { getDb } from "@clawd/db";
import { loadConfig, createLogger, getNumberSetting, setSetting, eventBus, CHAINS } from "@clawd/core";
import { computeDrawdown, shouldPauseTrading } from "./circuit-breaker.js";

const log = createLogger("router:drawdown-check");

/**
 * Computes drawdown per chain rather than one figure across the whole
 * platform — realized P&L is in each chain's own native units (SOL vs ETH
 * vs BNB, etc.), so summing them into a single number would require a
 * USD-conversion step this check deliberately doesn't take on. If ANY
 * chain's rolling-window drawdown breaches the threshold, the single global
 * TRADING_PAUSED Setting trips for every chain — a bad blowup on one chain
 * halting new trades everywhere is the conservative, intended behavior.
 */
async function checkDrawdown(): Promise<void> {
  const db = getDb();
  const cfg = loadConfig();

  const windowMs = cfg.DRAWDOWN_WINDOW_MS;
  const thresholdPct = await getNumberSetting("DRAWDOWN_THRESHOLD_PCT", cfg.DRAWDOWN_THRESHOLD_PCT);
  const windowStart = new Date(Date.now() - windowMs);

  for (const chain of CHAINS) {
    const sellTrades = await db.trade.findMany({
      where: { side: "sell", createdAt: { gte: windowStart }, position: { chain } },
      orderBy: { createdAt: "asc" },
      select: { profitAmount: true },
    });
    if (sellTrades.length === 0) continue;

    const deltasRaw = sellTrades.map((t) => BigInt(t.profitAmount));
    const drawdown = computeDrawdown(deltasRaw);

    if (shouldPauseTrading(drawdown.drawdownPct, thresholdPct)) {
      const message =
        `Circuit breaker tripped on ${chain}: realized P&L drawdown ` +
        `${(drawdown.drawdownPct * 100).toFixed(1)}% exceeds the ${(thresholdPct * 100).toFixed(0)}% ` +
        `threshold (${sellTrades.length} trades in window). New trades are paused platform-wide ` +
        `until an admin clears TRADING_PAUSED.`;
      log.warn(
        { chain, drawdownPct: drawdown.drawdownPct, thresholdPct, tradeCount: sellTrades.length },
        "Realized-P&L drawdown breached the circuit-breaker threshold — pausing new trades platform-wide",
      );
      await setSetting("TRADING_PAUSED", "true");
      eventBus.emit("admin.alert", { source: "circuit_breaker", message });
      return; // already tripped — no need to check the remaining chains this tick
    }
  }
}

/** Starts a recurring circuit-breaker check. Returns a function to stop it. */
export function startDrawdownCheck(intervalMs: number): () => void {
  const timer = setInterval(() => {
    checkDrawdown().catch((err) => log.error({ err }, "Drawdown check failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
