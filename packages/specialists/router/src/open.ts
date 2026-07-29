import { getDb } from "@clawd/db";
import {
  loadConfig,
  networkForChain,
  eventBus,
  createLogger,
  type Chain,
  type SignalSource,
} from "@clawd/core";
import { getChainAdapter, nativeQuoteAddress, parseNativeAmount } from "@clawd/chains";
import { computeTakeProfitPrice, computeStopLossPrice } from "./tp-sl.js";
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
) {
  const db = getDb();
  const cfg = loadConfig();
  const network = networkForChain(chain);

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

  const openCount = await db.position.count({ where: { chain, status: "open" } });
  if (openCount >= cfg.MAX_CONCURRENT_POSITIONS_PER_CHAIN) {
    log.info({ chain, openCount }, "Skipping — chain concurrent-position cap reached");
    return null;
  }

  const adapter = getChainAdapter(chain);
  const amountIn = parseNativeAmount(chain, wallet.tradeSizeNative);
  const quote = await adapter.getQuote(nativeQuoteAddress(chain), tokenAddress, amountIn);
  const result = await adapter.executeSwap(toEncryptedKey(wallet), quote);

  if (result.status !== "confirmed") {
    log.warn({ userId, chain, tokenAddress, txHash: result.txHash }, "Buy transaction failed");
    return null;
  }

  // Price is native-per-token so a rising price (token more expensive) reads as "up".
  const entryPrice = Number(result.amountIn) / Number(result.amountOut);
  const takeProfitPrice = computeTakeProfitPrice(entryPrice, cfg.TAKE_PROFIT_PCT);
  const stopLossPrice = computeStopLossPrice(entryPrice, cfg.STOP_LOSS_PCT);

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
