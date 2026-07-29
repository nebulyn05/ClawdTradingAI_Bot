import type { Bot } from "grammy";
import { eventBus, startSubscribingToRedis, createLogger } from "@clawd/core";
import { getDb } from "@clawd/db";
import type { BotContext } from "./types.js";
import { formatNativeAmount } from "./wallet-service.js";

const log = createLogger("bot:notifications");

async function sendToUser(bot: Bot<BotContext>, userId: string, text: string) {
  const user = await getDb().user.findUnique({ where: { id: userId } });
  if (!user) return;
  try {
    await bot.api.sendMessage(user.telegramId, text);
  } catch (err) {
    log.warn({ err, userId }, "Failed to deliver notification");
  }
}

/**
 * The worker process produces router.positionOpened / positionClosed events
 * — this subscribes to them (bridged over Redis, since bot and worker are
 * separate processes) and DMs the affected user on every entry and exit.
 */
export function wireNotifications(bot: Bot<BotContext>): () => void {
  const stopBridge = startSubscribingToRedis([
    "router.positionOpened",
    "router.positionClosed",
    "guard.rejected",
  ]);

  const offOpened = eventBus.on("router.positionOpened", (e) => {
    void sendToUser(
      bot,
      e.userId,
      `🟢 Opened a ${e.chain} position in ${e.tokenAddress}\n` +
        `Entry: ${e.entryPrice}\nTake-profit: ${e.takeProfitPrice} · Stop-loss: ${e.stopLossPrice}`,
    );
  });

  const offClosed = eventBus.on("router.positionClosed", (e) => {
    const profitRaw = BigInt(e.profitAmount);
    const outcome = e.profitable ? "✅ Profit" : "❌ Loss";
    const amountLine = e.profitable
      ? `Profit: +${formatNativeAmount(e.chain, profitRaw)}\nFee (2%): ${formatNativeAmount(e.chain, BigInt(e.feeAmount))}`
      : `Loss: -${formatNativeAmount(e.chain, -profitRaw)}`;
    void sendToUser(
      bot,
      e.userId,
      `${outcome} — closed ${e.chain} position in ${e.tokenAddress} (${e.reason})\n` +
        `Exit price: ${e.exitPrice}\n${amountLine}`,
    );
  });

  // Guard rejections aren't sent to users (no position was opened, nothing for
  // them to act on) — logged for operator visibility only.
  const offRejected = eventBus.on("guard.rejected", (e) => {
    log.info(e, "Guard rejected a token — no position opened");
  });

  return () => {
    offOpened();
    offClosed();
    offRejected();
    stopBridge();
  };
}
