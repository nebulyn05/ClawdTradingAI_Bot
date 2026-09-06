import { getDb } from "@clawd/db";
import { loadConfig, eventBus, createLogger, getNumberSetting, getSetting, type Chain, type ExitReason } from "@clawd/core";
import { getChainAdapter, nativeQuoteAddress } from "@clawd/chains";
import { computeFeeRaw } from "./tp-sl.js";
import { toEncryptedKey } from "./wallet-key.js";

const log = createLogger("router:close");

/** Admin-configured treasury address for this chain (Settings' TREASURY_ADDRESS_<CHAIN>), or null if unset. */
async function getTreasuryAddress(chain: Chain): Promise<string | null> {
  return getSetting(`TREASURY_ADDRESS_${chain.toUpperCase()}`);
}

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

    let feeLedgerId: string | null = null;
    if (profitable && feeRaw > 0n) {
      const feeLedgerEntry = await tx.feeLedger.create({
        data: { userId: position.userId, tradeId: trade.id, chain: position.chain, amount: feeRaw.toString() },
      });
      feeLedgerId = feeLedgerEntry.id;
    }

    const updatedPosition = await tx.position.update({
      where: { id: positionId },
      data: { status: "closed", exitPrice, exitReason: reason, closedAt: new Date() },
    });

    return { updatedPosition, feeLedgerId };
  });

  // Sweep the fee to the admin's configured treasury address, right after the
  // close transaction commits — a real on-chain transfer out of the user's own
  // wallet, not just a ledger entry. Best-effort: no treasury address configured,
  // or the transfer itself failing (insufficient gas headroom, RPC error), must
  // never undo or block the position close that already succeeded above.
  if (updated.feeLedgerId) {
    const treasuryAddress = await getTreasuryAddress(position.chain);
    if (treasuryAddress) {
      try {
        const sweepResult = await adapter.withdraw(toEncryptedKey(position.wallet), treasuryAddress, feeRaw);
        if (sweepResult.status === "confirmed") {
          await db.feeLedger.update({
            where: { id: updated.feeLedgerId },
            data: { sweptTxHash: sweepResult.txHash },
          });
        } else {
          log.warn({ positionId, txHash: sweepResult.txHash }, "Fee sweep transaction did not confirm");
        }
      } catch (err) {
        log.warn({ positionId, err }, "Fee sweep to treasury address failed — fee stays in user's wallet");
      }
    }
  }

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
  return updated.updatedPosition;
}
