import { getDb } from "@clawd/db";
import { loadConfig, eventBus, createLogger, getNumberSetting, type ExitReason } from "@clawd/core";
import { getChainAdapter, nativeQuoteAddress } from "@clawd/chains";
import { computeFeeRaw } from "./tp-sl.js";
import { toEncryptedKey } from "./wallet-key.js";

const log = createLogger("router:close");

/**
 * Closes an open position by selling its full token size back to the native
 * asset. Computes profit/fee in raw bigint units (lamports/wei) rather than
 * floating point, since typical trade sizes exceed Number's safe-integer
 * range once expressed in the smallest unit.
 */
export async function closePosition(positionId: string, reason: ExitReason) {
  const db = getDb();
  const cfg = loadConfig();

  const position = await db.position.findUniqueOrThrow({
    where: { id: positionId },
    include: { wallet: true },
  });
  if (position.status === "closed") return position;

  const adapter = getChainAdapter(position.chain);
  const tokensToSell = BigInt(position.sizeAmountIn);
  const quote = await adapter.getQuote(
    position.tokenAddress,
    nativeQuoteAddress(position.chain),
    tokensToSell,
  );
  const result = await adapter.executeSwap(toEncryptedKey(position.wallet), quote);

  if (result.status !== "confirmed") {
    log.warn({ positionId, txHash: result.txHash }, "Sell transaction failed — position stays open for retry");
    return null;
  }

  const buyTrade = await db.trade.findFirst({ where: { positionId, side: "buy" } });
  const nativeSpentRaw = BigInt(buyTrade?.amountIn ?? "0");
  const nativeReceivedRaw = BigInt(result.amountOut);
  const profitRaw = nativeReceivedRaw - nativeSpentRaw;
  const profitable = profitRaw > 0n;
  const feeRate = await getNumberSetting("PROFIT_FEE_RATE", cfg.PROFIT_FEE_RATE);
  const feeRaw = computeFeeRaw(profitRaw, feeRate);

  // native received per token sold — same "native per token" unit as entryPrice.
  const exitPrice = Number(result.amountOut) / Number(result.amountIn);

  const updated = await db.$transaction(async (tx) => {
    const trade = await tx.trade.create({
      data: {
        positionId,
        side: "sell",
        txHash: result.txHash,
        amountIn: result.amountIn,
        amountOut: result.amountOut,
        price: exitPrice,
        feeAmount: feeRaw.toString(),
        profitAmount: profitRaw.toString(),
        profitable,
      },
    });

    if (profitable && feeRaw > 0n) {
      await tx.feeLedger.create({
        data: { userId: position.userId, tradeId: trade.id, chain: position.chain, amount: feeRaw.toString() },
      });
    }

    return tx.position.update({
      where: { id: positionId },
      data: { status: "closed", exitPrice, exitReason: reason, closedAt: new Date() },
    });
  });

  eventBus.emit("router.positionClosed", {
    userId: position.userId,
    positionId,
    chain: position.chain,
    tokenAddress: position.tokenAddress,
    exitPrice,
    reason,
    profitable,
    profitAmount: profitRaw.toString(),
    feeAmount: feeRaw.toString(),
  });

  log.info({ positionId, reason, profitable, profitRaw: profitRaw.toString() }, "Position closed");
  return updated;
}
