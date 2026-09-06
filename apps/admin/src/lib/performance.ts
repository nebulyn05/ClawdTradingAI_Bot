import { getDb } from "@clawd/db";
import { computeDrawdown } from "@clawd/router";
import type { Chain, SignalSource } from "@clawd/core";

export const PERFORMANCE_WINDOWS = [7, 30, 90] as const;
export type PerformanceWindow = (typeof PERFORMANCE_WINDOWS)[number];

export interface ChainPerformance {
  chain: Chain;
  trades: number;
  winRate: number;
  /** Raw native-unit average (lamports/wei) — format with @clawd/chains' formatNativeAmount before display. */
  avgWinRaw: string;
  avgLossRaw: string;
  /** Total native-unit amount spent entering positions in this window (buy-side volume). */
  volumeRaw: string;
  maxDrawdownPct: number;
}

export interface PerformanceReport {
  windowDays: PerformanceWindow;
  source: SignalSource | "all";
  byChain: ChainPerformance[];
}

/**
 * Rolling win rate / average win-loss size / max drawdown / volume for a
 * time window, optionally filtered by signal source. Broken out by chain
 * rather than combined into one number — native units differ per chain
 * (SOL vs ETH vs BNB), so summing raw amounts across chains isn't
 * meaningful (same reasoning as circuit-breaker.ts's per-chain drawdown
 * check, whose computeDrawdown this reuses rather than reimplementing).
 *
 * This is meant to be the single source of truth for "how is the bot
 * performing" — call it from here and, later, from a bot command exposing
 * the same numbers to end users, rather than each caller running its own
 * query.
 */
export async function getPerformanceReport(
  windowDays: PerformanceWindow,
  source?: SignalSource,
): Promise<PerformanceReport> {
  const db = getDb();
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const positionFilter = source ? { source } : undefined;

  const [sellTrades, buyTrades] = await Promise.all([
    db.trade.findMany({
      where: { side: "sell", createdAt: { gte: windowStart }, position: positionFilter },
      orderBy: { createdAt: "asc" },
      select: { profitAmount: true, profitable: true, position: { select: { chain: true } } },
    }),
    db.trade.findMany({
      where: { side: "buy", createdAt: { gte: windowStart }, position: positionFilter },
      select: { amountIn: true, position: { select: { chain: true } } },
    }),
  ]);

  const chains = new Set<Chain>([
    ...sellTrades.map((t) => t.position.chain),
    ...buyTrades.map((t) => t.position.chain),
  ]);

  const byChain: ChainPerformance[] = [...chains].map((chain) => {
    const chainSells = sellTrades.filter((t) => t.position.chain === chain);
    const chainBuys = buyTrades.filter((t) => t.position.chain === chain);

    const wins = chainSells.filter((t) => t.profitable);
    const losses = chainSells.filter((t) => !t.profitable);

    const avgWinRaw =
      wins.length === 0 ? 0n : wins.reduce((sum, t) => sum + BigInt(t.profitAmount), 0n) / BigInt(wins.length);
    const avgLossRaw =
      losses.length === 0
        ? 0n
        : losses.reduce((sum, t) => sum - BigInt(t.profitAmount), 0n) / BigInt(losses.length);
    const volumeRaw = chainBuys.reduce((sum, t) => sum + BigInt(t.amountIn), 0n);
    const drawdown = computeDrawdown(chainSells.map((t) => BigInt(t.profitAmount)));

    return {
      chain,
      trades: chainSells.length,
      winRate: chainSells.length === 0 ? 0 : wins.length / chainSells.length,
      avgWinRaw: avgWinRaw.toString(),
      avgLossRaw: avgLossRaw.toString(),
      volumeRaw: volumeRaw.toString(),
      maxDrawdownPct: drawdown.drawdownPct,
    };
  });

  return { windowDays, source: source ?? "all", byChain };
}
