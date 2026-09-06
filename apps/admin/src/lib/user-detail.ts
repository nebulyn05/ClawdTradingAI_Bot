import { getDb, type Wallet } from "@clawd/db";
import { getRecentTransactions } from "@clawd/chains";
import { getLiveBalance, getUsdValue } from "./balances";

export interface WalletDetail extends Wallet {
  /** Live on-chain balance, raw units — null if the RPC call failed/timed out (shown as "unavailable", never a fabricated 0). */
  liveBalance: bigint | null;
  /** Best-effort USD value of liveBalance (display estimate, via Pyth) — null if unpriced or liveBalance itself is null. */
  usdValue: number | null;
  /** True if another wallet row for this user shares the identical address (the shared-EVM-address model). */
  sharedAddress: boolean;
  /** "unsupported" (no data source for this chain) vs "unavailable" (had a source, the live call failed) vs "ok" — see getRecentTransactions. */
  txHistoryStatus: "ok" | "unavailable" | "unsupported";
}

export interface OnChainTransaction {
  chain: string;
  walletAddress: string;
  hash: string;
  timestamp: Date | null;
  direction: "in" | "out" | "self" | "unknown";
  valueRaw: bigint;
  success: boolean;
}

export interface UserDetail {
  id: string;
  telegramId: string;
  telegramUsername: string | null;
  createdAt: Date;
  hasExportPassphrase: boolean;
  takeProfitPctOverride: number | null;
  stopLossPctOverride: number | null;
  ruggGuardEnabled: boolean;
  antiMevEnabled: boolean;
  alertsEnabled: boolean;
  languageCode: string;
  referralCode: string | null;
  referredBy: { id: string; telegramUsername: string | null; telegramId: string } | null;
  referralCount: number;
  wallets: WalletDetail[];
  /** Sum of every priced wallet's usdValue — null only if no wallet had a live price at all. */
  totalBalanceUsd: number | null;
  /** Live on-chain activity merged across every wallet, newest first, capped — the actual blockchain
   * history for these addresses (deposits, manual transfers, bot-executed swaps, everything), distinct
   * from recentTrades below which only ever reflects trades this bot itself executed. */
  onChainTransactions: OnChainTransaction[];
  openPositions: Array<{
    id: string;
    chain: string;
    tokenAddress: string;
    source: string;
    entryPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    sizeAmountIn: string;
    openedAt: Date;
  }>;
  recentTrades: Array<{
    id: string;
    side: string;
    chain: string;
    tokenAddress: string;
    /** The wallet address (this user's, on this chain) the transaction executed from. */
    walletAddress: string;
    txHash: string;
    amountIn: string;
    amountOut: string;
    profitable: boolean;
    profitAmount: string;
    createdAt: Date;
  }>;
  stats: { totalTrades: number; wins: number; losses: number; closedPositions: number };
}

/**
 * Full profile for a single user — balances (live, best-effort), settings
 * overrides, open positions, recent trades, and referral info. This is the
 * one place the admin dashboard's user detail page reads from, mirroring
 * performance.ts's role as the single source of truth for its own report.
 */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const tStart = Date.now(); // TEMPORARY diagnostic timing
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      wallets: { orderBy: { chain: "asc" } },
      referredBy: { select: { id: true, telegramUsername: true, telegramId: true } },
      _count: { select: { referrals: true } },
    },
  });
  console.log(`[timing] initial user query: ${Date.now() - tStart}ms`);
  if (!user) return null;

  const addressCounts = new Map<string, number>();
  for (const w of user.wallets) addressCounts.set(w.address, (addressCounts.get(w.address) ?? 0) + 1);

  const TX_HISTORY_LIMIT = 10;
  const walletsWithTx = await Promise.all(
    user.wallets.map(async (wallet) => {
      // TEMPORARY diagnostic timing — remove once the 25s+ page-load report is root-caused.
      const t0 = Date.now();
      const [liveBalance, txHistory] = await Promise.all([
        getLiveBalance(wallet.chain, wallet.address),
        getRecentTransactions(wallet.chain, wallet.address, TX_HISTORY_LIMIT),
      ]);
      const t1 = Date.now();
      const usdValue = liveBalance !== null ? await getUsdValue(wallet.chain, liveBalance) : null;
      const t2 = Date.now();
      console.log(
        `[timing] wallet ${wallet.chain} balance+tx=${t1 - t0}ms usdValue=${t2 - t1}ms total=${t2 - t0}ms` +
          ` (balance=${liveBalance !== null ? "ok" : "null"} tx=${txHistory.status} usd=${usdValue !== null ? "ok" : "null"})`,
      );
      const detail: WalletDetail = {
        ...wallet,
        liveBalance,
        usdValue,
        sharedAddress: (addressCounts.get(wallet.address) ?? 0) > 1,
        txHistoryStatus: txHistory.status,
      };
      return { detail, transactions: txHistory.entries };
    }),
  );
  const wallets = walletsWithTx.map((w) => w.detail);
  const pricedWallets = wallets.filter((w) => w.usdValue !== null);
  const totalBalanceUsd = pricedWallets.length > 0 ? pricedWallets.reduce((sum, w) => sum + (w.usdValue ?? 0), 0) : null;

  const onChainTransactions: OnChainTransaction[] = walletsWithTx
    .flatMap(({ detail, transactions }) =>
      transactions.map((tx) => ({
        chain: detail.chain,
        walletAddress: detail.address,
        hash: tx.hash,
        timestamp: tx.timestamp,
        direction: tx.direction,
        valueRaw: tx.valueRaw,
        success: tx.success,
      })),
    )
    .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
    .slice(0, 25);
  console.log(`[timing] all wallets settled at: ${Date.now() - tStart}ms`); // TEMPORARY diagnostic timing

  const [openPositions, recentTrades, closedCount, sellTrades] = await Promise.all([
    db.position.findMany({
      where: { userId, status: "open" },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        chain: true,
        tokenAddress: true,
        source: true,
        entryPrice: true,
        takeProfitPrice: true,
        stopLossPrice: true,
        sizeAmountIn: true,
        openedAt: true,
      },
    }),
    db.trade.findMany({
      where: { position: { userId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        side: true,
        txHash: true,
        amountIn: true,
        amountOut: true,
        profitable: true,
        profitAmount: true,
        createdAt: true,
        position: { select: { chain: true, tokenAddress: true, wallet: { select: { address: true } } } },
      },
    }),
    db.position.count({ where: { userId, status: "closed" } }),
    db.trade.findMany({
      where: { position: { userId }, side: "sell" },
      select: { profitable: true },
    }),
  ]);

  const wins = sellTrades.filter((t) => t.profitable).length;
  console.log(`[timing] getUserDetail total: ${Date.now() - tStart}ms`); // TEMPORARY diagnostic timing

  return {
    id: user.id,
    telegramId: user.telegramId,
    telegramUsername: user.telegramUsername,
    createdAt: user.createdAt,
    hasExportPassphrase: Boolean(user.exportPassphraseHash),
    takeProfitPctOverride: user.takeProfitPctOverride,
    stopLossPctOverride: user.stopLossPctOverride,
    ruggGuardEnabled: user.ruggGuardEnabled,
    antiMevEnabled: user.antiMevEnabled,
    alertsEnabled: user.alertsEnabled,
    languageCode: user.languageCode,
    referralCode: user.referralCode,
    referredBy: user.referredBy,
    referralCount: user._count.referrals,
    wallets,
    totalBalanceUsd,
    onChainTransactions,
    openPositions: openPositions.map((p) => ({ ...p, chain: p.chain, source: p.source })),
    recentTrades: recentTrades.map((t) => ({
      id: t.id,
      side: t.side,
      chain: t.position.chain,
      tokenAddress: t.position.tokenAddress,
      walletAddress: t.position.wallet.address,
      txHash: t.txHash,
      amountIn: t.amountIn,
      amountOut: t.amountOut,
      profitable: t.profitable,
      profitAmount: t.profitAmount,
      createdAt: t.createdAt,
    })),
    stats: { totalTrades: sellTrades.length, wins, losses: sellTrades.length - wins, closedPositions: closedCount },
  };
}
