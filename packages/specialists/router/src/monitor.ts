import { getDb } from "@clawd/db";
import { createLogger } from "@clawd/core";
import { getChainAdapter, nativeQuoteAddress } from "@clawd/chains";
import { getOrScreenToken } from "@clawd/guard";
import { checkExitTrigger } from "./tp-sl.js";
import { closePosition } from "./close.js";

const log = createLogger("router:monitor");

/**
 * Re-quotes every open position and closes any that have hit take-profit or
 * stop-loss. Also re-runs Guard on the position's token — `getOrScreenToken`
 * is cache-backed (10 min default), so this is cheap on every tick except
 * when the cache actually expires. If a token that passed at entry now
 * fails (mint authority re-enabled, liquidity pulled, etc.), the position is
 * closed immediately with `exitReason: "guard_exit"`, ahead of any price
 * check — an emerging rug risk overrides a TP/SL target that hasn't hit yet.
 */
export async function checkOpenPositions(): Promise<void> {
  const db = getDb();
  const openPositions = await db.position.findMany({ where: { status: "open" } });

  for (const position of openPositions) {
    try {
      const safety = await getOrScreenToken(position.chain, position.tokenAddress).catch((err) => {
        log.warn({ err, positionId: position.id }, "Guard re-check failed — skipping this tick's safety check");
        return null;
      });
      if (safety && !safety.passed) {
        log.warn(
          { positionId: position.id, reasons: safety.reasons },
          "Guard re-check failed on an open position — closing",
        );
        await closePosition(position.id, "guard_exit");
        continue;
      }

      const adapter = getChainAdapter(position.chain);
      const tokensHeld = BigInt(position.sizeAmountIn);
      const quote = await adapter.getQuote(
        position.tokenAddress,
        nativeQuoteAddress(position.chain),
        tokensHeld,
      );
      const currentPrice = Number(quote.amountOut) / Number(quote.amountIn);

      const trigger = checkExitTrigger(currentPrice, position.takeProfitPrice, position.stopLossPrice);
      if (trigger) {
        log.info({ positionId: position.id, trigger, currentPrice }, "Exit triggered");
        await closePosition(position.id, trigger);
      }
    } catch (err) {
      log.warn({ err, positionId: position.id }, "Failed to check position — will retry next tick");
    }
  }
}

/** Starts a recurring position-monitor loop. Returns a function to stop it. */
export function startPositionMonitor(intervalMs: number): () => void {
  const timer = setInterval(() => {
    checkOpenPositions().catch((err) => log.error({ err }, "Position monitor tick failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
