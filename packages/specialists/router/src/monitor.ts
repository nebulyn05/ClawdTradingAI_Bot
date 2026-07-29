import { getDb } from "@clawd/db";
import { createLogger } from "@clawd/core";
import { getChainAdapter, nativeQuoteAddress } from "@clawd/chains";
import { checkExitTrigger } from "./tp-sl.js";
import { closePosition } from "./close.js";

const log = createLogger("router:monitor");

/** Re-quotes every open position and closes any that have hit take-profit or stop-loss. */
export async function checkOpenPositions(): Promise<void> {
  const db = getDb();
  const openPositions = await db.position.findMany({ where: { status: "open" } });

  for (const position of openPositions) {
    try {
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
