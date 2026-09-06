import { getDb } from "@clawd/db";
import {
  loadConfig,
  networkForChain,
  eventBus,
  createLogger,
  getNumberSetting,
  getBooleanSetting,
  type Chain,
  type SignalSource,
  type Env,
} from "@clawd/core";
import { getChainAdapter, nativeQuoteAddress, parseNativeAmount } from "@clawd/chains";
import { computeTakeProfitPrice, computeStopLossPrice } from "./tp-sl.js";
import { checkPortfolioExposure, maxAdditionalExposureRaw } from "./exposure.js";
import { computeCategoryStats, computePositionSize } from "./sizing.js";
import { toEncryptedKey } from "./wallet-key.js";

const log = createLogger("router:open");

/**
 * Opens a position for `userId` in `tokenAddress` on `chain`, if the wallet
 * is active and the risk checks (no duplicate open position in this token,
 * per-chain concurrency cap) pass. Returns null (with a log line) when a
 * check skips the trade rather than throwing — a skip is an expected,
 * routine outcome, not a failure.
 */
export async function openPosition(
  userId: string,
  chain: Chain,
  tokenAddress: string,
  source: SignalSource,
  /** Overrides the wallet's configured tradeSizeNative — used by the admin rule engine and manual trades. Bypasses dynamic (Kelly) sizing, since these already carry an explicit intended size, but the portfolio exposure cap still applies. */
  overrideSizeNative?: string,
) {
  const db = getDb();
  const cfg = loadConfig();
  const network = networkForChain(chain);

  // Circuit breaker (see circuit-breaker.ts / drawdown-check.ts): only ever
  // set to true automatically on a drawdown breach, cleared only by a
  // deliberate admin action — rejects new trades without touching existing
  // open positions, which keep being monitored/closed by monitor.ts as usual.
  if (await getBooleanSetting("TRADING_PAUSED", false)) {
    log.info({ userId, chain, tokenAddress }, "Skipping — trading is paused (circuit breaker)");
    return null;
  }

  const wallet = await db.wallet.findUnique({
    where: { userId_chain_network: { userId, chain, network } },
  });
  if (!wallet || !wallet.active) return null;

  const existingOpen = await db.position.findFirst({
    where: { userId, chain, tokenAddress, status: "open" },
  });
  if (existingOpen) {
    log.info({ userId, chain, tokenAddress }, "Skipping — already have an open position in this token");
    return null;
  }

  const maxConcurrent = await getNumberSetting(
    "MAX_CONCURRENT_POSITIONS_PER_CHAIN",
    cfg.MAX_CONCURRENT_POSITIONS_PER_CHAIN,
  );
  const openCount = await db.position.count({ where: { chain, status: "open" } });
  if (openCount >= maxConcurrent) {
    log.info({ chain, openCount, maxConcurrent }, "Skipping — chain concurrent-position cap reached");
    return null;
  }

  const adapter = getChainAdapter(chain);
  const portfolio = await getPortfolioState(userId, chain, wallet.address);
  const maxExposurePct = await getNumberSetting("MAX_PORTFOLIO_EXPOSURE_PCT", cfg.MAX_PORTFOLIO_EXPOSURE_PCT);
  const exposureCeilingRaw = maxAdditionalExposureRaw(
    portfolio.openPositionValuesRaw,
    portfolio.walletBalanceRaw,
    maxExposurePct,
  );

  let amountIn: bigint;
  if (overrideSizeNative) {
    amountIn = parseNativeAmount(chain, overrideSizeNative);
  } else if (wallet.buyAmountOverride) {
    // User-configured fixed buy amount (bot Settings' Trading section) — same
    // "explicit size bypasses dynamic sizing" reasoning as overrideSizeNative.
    amountIn = parseNativeAmount(chain, wallet.buyAmountOverride);
  } else {
    const sizing = await computeDynamicSize(
      chain,
      source,
      wallet.tradeSizeNative,
      portfolio.walletBalanceRaw,
      exposureCeilingRaw,
      cfg,
    );
    if (sizing.sizeRaw <= 0n) {
      log.info(
        { userId, chain, tokenAddress, source, reason: sizing.reason },
        "Skipping — position sizing rejected the trade",
      );
      return null;
    }
    amountIn = sizing.sizeRaw;
  }

  const exposureCheck = checkPortfolioExposure(
    portfolio.openPositionValuesRaw,
    amountIn,
    portfolio.walletBalanceRaw,
    maxExposurePct,
  );
  if (!exposureCheck.approved) {
    const reason = exposureCheck.reason ?? "Portfolio exposure cap exceeded";
    log.info({ userId, chain, tokenAddress, reason }, "Rejected — portfolio exposure cap");
    eventBus.emit("router.exposureCapRejected", { userId, chain, tokenAddress, reason });
    return null;
  }

  const quote = await adapter.getQuote(nativeQuoteAddress(chain), tokenAddress, amountIn);
  const result = await adapter.executeSwap(toEncryptedKey(wallet), quote);

  if (result.status !== "confirmed") {
    log.warn({ userId, chain, tokenAddress, txHash: result.txHash }, "Buy transaction failed");
    return null;
  }

  // Price is native-per-token so a rising price (token more expensive) reads as "up".
  const entryPrice = Number(result.amountIn) / Number(result.amountOut);
  // Per-user override (bot Settings' Trading section) beats the global Setting, which
  // in turn beats the env default — same override precedence as buyAmountOverride above.
  const userTargets = await db.user.findUnique({
    where: { id: userId },
    select: { takeProfitPctOverride: true, stopLossPctOverride: true },
  });
  const takeProfitPct =
    userTargets?.takeProfitPctOverride ?? (await getNumberSetting("TAKE_PROFIT_PCT", cfg.TAKE_PROFIT_PCT));
  const stopLossPct =
    userTargets?.stopLossPctOverride ?? (await getNumberSetting("STOP_LOSS_PCT", cfg.STOP_LOSS_PCT));
  const takeProfitPrice = computeTakeProfitPrice(entryPrice, takeProfitPct);
  const stopLossPrice = computeStopLossPrice(entryPrice, stopLossPct);

  const position = await db.position.create({
    data: {
      userId,
      walletId: wallet.id,
      chain,
      tokenAddress,
      source,
      entryPrice,
      sizeAmountIn: result.amountOut, // tokens received — what Router will sell on close
      takeProfitPrice,
      stopLossPrice,
      trades: {
        create: {
          side: "buy",
          txHash: result.txHash,
          amountIn: result.amountIn,
          amountOut: result.amountOut,
          price: entryPrice,
        },
      },
    },
  });

  eventBus.emit("router.positionOpened", {
    userId,
    positionId: position.id,
    chain,
    tokenAddress,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
  });

  log.info({ userId, chain, tokenAddress, positionId: position.id }, "Position opened");
  return position;
}

interface PortfolioState {
  /** Current native-unit value of every open position this user holds on `chain`. */
  openPositionValuesRaw: bigint[];
  /** The wallet's uninvested native-unit balance. */
  walletBalanceRaw: bigint;
}

/**
 * Fetches this user's open positions on `chain` and re-quotes each to its
 * current native-unit value (falling back to its original cost basis if the
 * re-quote fails — an illiquid position shouldn't block a risk check
 * entirely), plus the wallet's uninvested balance. Shared I/O feeding both
 * the portfolio-exposure cap and dynamic position sizing, so a single
 * `openPosition` call only re-quotes each open position once.
 */
async function getPortfolioState(userId: string, chain: Chain, walletAddress: string): Promise<PortfolioState> {
  const db = getDb();
  const adapter = getChainAdapter(chain);

  const openPositions = await db.position.findMany({
    where: { userId, chain, status: "open" },
    include: { trades: { where: { side: "buy" }, take: 1 } },
  });

  const openPositionValuesRaw = await Promise.all(
    openPositions.map(async (position) => {
      try {
        const quote = await adapter.getQuote(
          position.tokenAddress,
          nativeQuoteAddress(chain),
          BigInt(position.sizeAmountIn),
        );
        return BigInt(quote.amountOut);
      } catch (err) {
        log.warn(
          { err, positionId: position.id },
          "Failed to re-quote open position for a risk check — falling back to cost basis",
        );
        return BigInt(position.trades[0]?.amountIn ?? "0");
      }
    }),
  );

  const walletBalanceRaw = await adapter.getBalance(walletAddress);
  return { openPositionValuesRaw, walletBalanceRaw };
}

/**
 * I/O side of dynamic position sizing: pulls this category's (signal
 * source's) closed-trade history, derives win rate / win-loss ratio from it
 * (or null if there isn't enough yet), then hands everything to the pure
 * `computePositionSize`.
 */
async function computeDynamicSize(
  chain: Chain,
  source: SignalSource,
  walletTradeSizeNative: string,
  availableBalanceRaw: bigint,
  exposureCeilingRaw: bigint,
  cfg: Env,
) {
  const db = getDb();
  const closedTrades = await db.trade.findMany({
    where: { side: "sell", position: { source } },
    select: { profitable: true, profitAmount: true },
  });
  const stats = computeCategoryStats(closedTrades);

  const [kellyFraction, maxPositionPct] = await Promise.all([
    getNumberSetting("KELLY_FRACTION", cfg.KELLY_FRACTION),
    getNumberSetting("MAX_POSITION_SIZE_PCT", cfg.MAX_POSITION_SIZE_PCT),
  ]);

  return computePositionSize({
    stats,
    availableBalanceRaw,
    fallbackSizeRaw: parseNativeAmount(chain, walletTradeSizeNative),
    kellyFraction,
    maxPositionPct,
    maxAdditionalExposureRaw: exposureCeilingRaw,
  });
}
