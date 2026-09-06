import { getDb } from "@clawd/db";
import type { Chain, ExitReason } from "@clawd/core";
import { NATIVE_DECIMALS } from "@clawd/chains";
import { getNativeAssetUsdPrice } from "@clawd/pricing";
import { listWallets, getWalletBalance, formatNativeAmount } from "./wallet-service.js";

export interface ChainPortfolioEntry {
  chain: Chain;
  active: boolean;
  balanceRaw: bigint;
  formatted: string;
  /** null means "price unavailable" (Monad/Robinhood — see @clawd/pricing's native-price.ts), not $0. */
  usd: number | null;
}

export interface PortfolioSummary {
  perChain: ChainPortfolioEntry[];
  /** Sum of every chain with a known price — chains with usd: null don't contribute (never fabricated as $0). */
  totalUsd: number;
}

/**
 * Per-chain balance + USD value for every wallet the user has, plus a total.
 * Display-only — uses ordinary floats (not the raw-bigint math tp-sl.ts/
 * sizing.ts use for actual settlement), since this never moves funds.
 */
export async function getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
  const wallets = await listWallets(userId);

  const perChain = await Promise.all(
    wallets.map(async (wallet): Promise<ChainPortfolioEntry> => {
      const [balanceRaw, usdPrice] = await Promise.all([
        getWalletBalance(userId, wallet.chain).catch(() => 0n),
        getNativeAssetUsdPrice(wallet.chain),
      ]);
      const formatted = formatNativeAmount(wallet.chain, balanceRaw);
      const usd = usdPrice !== null ? Number(formatted) * usdPrice : null;
      return { chain: wallet.chain, active: wallet.active, balanceRaw, formatted, usd };
    }),
  );

  const totalUsd = perChain.reduce((sum, entry) => sum + (entry.usd ?? 0), 0);
  return { perChain, totalUsd };
}

export interface ClosedPositionSummary {
  chain: Chain;
  tokenAddress: string;
  exitReason: ExitReason | null;
  entryPrice: number;
  exitPrice: number | null;
  closedAt: Date | null;
}

/** Most recently closed positions, newest first. */
export async function getClosedPositions(userId: string, limit = 10): Promise<ClosedPositionSummary[]> {
  const positions = await getDb().position.findMany({
    where: { userId, status: "closed" },
    orderBy: { closedAt: "desc" },
    take: limit,
  });
  return positions.map((p) => ({
    chain: p.chain,
    tokenAddress: p.tokenAddress,
    exitReason: p.exitReason,
    entryPrice: p.entryPrice,
    exitPrice: p.exitPrice,
    closedAt: p.closedAt,
  }));
}

export interface TradeHistoryEntry {
  chain: Chain;
  tokenAddress: string;
  side: "buy" | "sell";
  formattedAmount: string;
  /** null for buy trades — profitability only applies to a completed (sell) trade. */
  profitable: boolean | null;
  createdAt: Date;
}

/** Most recent buy/sell trades across every position, newest first. */
export async function getTradeHistory(userId: string, limit = 10): Promise<TradeHistoryEntry[]> {
  const trades = await getDb().trade.findMany({
    where: { position: { userId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { position: { select: { chain: true, tokenAddress: true } } },
  });
  return trades.map((t) => ({
    chain: t.position.chain,
    tokenAddress: t.position.tokenAddress,
    side: t.side,
    formattedAmount: formatNativeAmount(t.position.chain, BigInt(t.side === "buy" ? t.amountIn : t.amountOut)),
    profitable: t.side === "sell" ? t.profitable : null,
    createdAt: t.createdAt,
  }));
}

/** Converts a signed raw native-unit amount (profitAmount can be negative) to a float — formatNativeAmount is unsigned-only (built for balances), so it can't be reused here. Display-only, same reasoning as getPortfolioSummary. */
function signedNativeToNumber(chain: Chain, raw: bigint): number {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const divisor = 10n ** BigInt(NATIVE_DECIMALS[chain]);
  const value = Number(abs / divisor) + Number(abs % divisor) / Number(divisor);
  return negative ? -value : value;
}

export interface PnlBreakdown {
  usd24h: number;
  usd7d: number;
  usd30d: number;
  usdAll: number;
  wins: number;
  losses: number;
  trades: number;
}

/**
 * Cumulative realized PnL in USD over rolling windows, converted at each
 * chain's CURRENT native-asset price (not the price at trade time, which
 * isn't stored anywhere) — a documented approximation for a summary display,
 * not a settlement figure. Chains with no price feed (Monad/Robinhood) are
 * excluded from the USD sums entirely rather than counted as $0.
 */
export async function getPnlBreakdown(userId: string): Promise<PnlBreakdown> {
  const sellTrades = await getDb().trade.findMany({
    where: { side: "sell", position: { userId } },
    select: { profitAmount: true, profitable: true, createdAt: true, position: { select: { chain: true } } },
  });

  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
  const cutoff30d = now - 30 * 24 * 60 * 60 * 1000;

  const priceCache = new Map<Chain, number | null>();
  async function priceFor(chain: Chain): Promise<number | null> {
    if (!priceCache.has(chain)) priceCache.set(chain, await getNativeAssetUsdPrice(chain));
    return priceCache.get(chain) ?? null;
  }

  let usd24h = 0;
  let usd7d = 0;
  let usd30d = 0;
  let usdAll = 0;
  let wins = 0;
  let losses = 0;

  for (const trade of sellTrades) {
    if (trade.profitable) wins++;
    else losses++;

    const price = await priceFor(trade.position.chain);
    if (price === null) continue;

    const profitUsd = signedNativeToNumber(trade.position.chain, BigInt(trade.profitAmount)) * price;
    usdAll += profitUsd;
    const ts = trade.createdAt.getTime();
    if (ts >= cutoff24h) usd24h += profitUsd;
    if (ts >= cutoff7d) usd7d += profitUsd;
    if (ts >= cutoff30d) usd30d += profitUsd;
  }

  return { usd24h, usd7d, usd30d, usdAll, wins, losses, trades: sellTrades.length };
}
