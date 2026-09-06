import { getDb } from "@clawd/db";
import type { HistoricalSignal } from "./types.js";

/**
 * Reads closed Position/Trade rows as backtest ground truth. Read-only —
 * never writes to the DB and never touches a chain adapter, so running a
 * backtest can't execute a real trade or mutate live state.
 */
export async function loadHistoricalSignals(options: { sinceDays?: number } = {}): Promise<HistoricalSignal[]> {
  const db = getDb();

  const where = options.sinceDays
    ? {
        status: "closed" as const,
        openedAt: { gte: new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000) },
      }
    : { status: "closed" as const };

  const positions = await db.position.findMany({
    where,
    include: { trades: true },
  });

  if (positions.length === 0) return [];

  const safetyChecks = await db.safetyCheck.findMany({
    where: { OR: positions.map((p) => ({ chain: p.chain, tokenAddress: p.tokenAddress })) },
  });
  const safetyByKey = new Map(safetyChecks.map((s) => [`${s.chain}:${s.tokenAddress}`, s]));

  const signals: HistoricalSignal[] = [];
  for (const position of positions) {
    const buyTrade = position.trades.find((t) => t.side === "buy");
    const sellTrade = position.trades.find((t) => t.side === "sell");
    if (!buyTrade || !sellTrade || position.exitPrice === null) continue;

    const safety = safetyByKey.get(`${position.chain}:${position.tokenAddress}`);

    signals.push({
      positionId: position.id,
      source: position.source,
      chain: position.chain,
      tokenAddress: position.tokenAddress,
      openedAt: position.openedAt,
      guardScore: safety?.score ?? null,
      guardChecks: (safety?.checks as Record<string, boolean> | undefined) ?? null,
      returnPct: (position.exitPrice - position.entryPrice) / position.entryPrice,
      profitAmountRaw: BigInt(sellTrade.profitAmount),
      actualSizeRaw: BigInt(buyTrade.amountIn),
      profitable: sellTrade.profitable,
    });
  }

  return signals;
}
