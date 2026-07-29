import { getDb } from "@clawd/db";
import { createLogger } from "@clawd/core";
import { getChainAdapter, nativeQuoteAddress } from "@clawd/chains";
import { getOrScreenToken } from "@clawd/guard";
import { reviewTpSlWithAi } from "@clawd/ai";
import { computeTakeProfitPrice, computeStopLossPrice } from "./tp-sl.js";

const log = createLogger("router:ai-tp-sl");

/**
 * Periodic (not per-tick) AI re-evaluation of every open position's TP/SL
 * targets. Runs on its own, much slower interval than the position
 * monitor's fast deterministic price check — an LLM call per position isn't
 * something you want on a 15s loop. A no-op when AI features are disabled
 * (reviewTpSlWithAi returns null immediately).
 */
export async function reviewOpenPositionsTpSl(): Promise<void> {
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

      const currentTakeProfitPct = position.takeProfitPrice / position.entryPrice - 1;
      const currentStopLossPct = 1 - position.stopLossPrice / position.entryPrice;
      const safety = await getOrScreenToken(position.chain, position.tokenAddress);
      const openForMs = Date.now() - position.openedAt.getTime();

      const review = await reviewTpSlWithAi(
        position.chain,
        position.entryPrice,
        currentPrice,
        currentTakeProfitPct,
        currentStopLossPct,
        safety.score,
        openForMs,
      );
      if (!review) continue;

      const takeProfitPrice = computeTakeProfitPrice(position.entryPrice, review.takeProfitPct);
      const stopLossPrice = computeStopLossPrice(position.entryPrice, review.stopLossPct);

      await db.position.update({
        where: { id: position.id },
        data: { takeProfitPrice, stopLossPrice },
      });
      log.info(
        { positionId: position.id, takeProfitPrice, stopLossPrice, reasoning: review.reasoning },
        "AI adjusted TP/SL targets",
      );
    } catch (err) {
      log.warn({ err, positionId: position.id }, "AI TP/SL review failed for this position — will retry next pass");
    }
  }
}

/** Starts a recurring AI TP/SL review loop. Returns a function to stop it. */
export function startAiTpSlReview(intervalMs: number): () => void {
  const timer = setInterval(() => {
    reviewOpenPositionsTpSl().catch((err) => log.error({ err }, "AI TP/SL review tick failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
