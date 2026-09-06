import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { getDb } from "@clawd/db";
import { loadConfig, getNumberSetting, getBooleanSetting, createLogger } from "@clawd/core";
import type { BotContext } from "./types.js";

const log = createLogger("bot:reengagement");

function nudgeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("⚡ Activate Clawd Agent", "menu:activate").text("💳 Deposit", "wallet:deposit");
}

function renderMessage(content: string, minDepositUsd: number): string {
  return content.replaceAll("${minDepositUsd}", minDepositUsd.toFixed(0));
}

async function sendNudge(bot: Bot<BotContext>, telegramId: string, content: string, minDepositUsd: number) {
  await bot.api.sendMessage(telegramId, renderMessage(content, minDepositUsd), {
    parse_mode: "Markdown",
    reply_markup: nudgeKeyboard(),
  });
}

async function runNudgeCheck(bot: Bot<BotContext>): Promise<void> {
  const cfg = loadConfig();
  const db = getDb();
  const minDepositUsd = await getNumberSetting("MIN_DEPOSIT_USD", cfg.MIN_DEPOSIT_USD);

  // 1. Manual admin-triggered sends (apps/admin's manualNudgeAction queues
  // these via pendingManualNudgeMessageId) — bypass cooldown/cap entirely,
  // since this is an explicit operator action, not part of the automatic
  // cadence. Cleared after send regardless of delivery outcome.
  const manual = await db.user.findMany({
    where: { pendingManualNudgeMessageId: { not: null }, alertsEnabled: true },
    select: { id: true, telegramId: true, pendingManualNudgeMessage: { select: { content: true } } },
  });
  for (const user of manual) {
    if (user.pendingManualNudgeMessage) {
      try {
        await sendNudge(bot, user.telegramId, user.pendingManualNudgeMessage.content, minDepositUsd);
      } catch (err) {
        log.warn({ err, userId: user.id }, "Manual nudge delivery failed");
      }
    }
    await db.user.update({ where: { id: user.id }, data: { pendingManualNudgeMessageId: null } });
  }

  // 2. Automatic cadence — honest reminders only, no fabricated urgency or
  // discounts (see CLAUDE.md's re-engagement nudges section).
  if (!(await getBooleanSetting("NUDGE_MESSAGES_ENABLED", cfg.NUDGE_MESSAGES_ENABLED))) return;
  const cooldownHours = await getNumberSetting("NUDGE_COOLDOWN_HOURS", cfg.NUDGE_COOLDOWN_HOURS);
  const maxNudges = await getNumberSetting("NUDGE_MAX_COUNT", cfg.NUDGE_MAX_COUNT);
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

  const messages = await db.nudgeMessage.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  if (messages.length === 0) return; // admin hasn't configured any message content yet

  // Any onboarded user (they exist in this table via /start) who hasn't
  // activated a wallet qualifies — including someone who never created/
  // imported one at all, not just users with an inactive wallet.
  const candidates = await db.user.findMany({
    where: {
      alertsEnabled: true,
      nudgeCount: { lt: maxNudges },
      OR: [{ lastNudgedAt: null }, { lastNudgedAt: { lte: cutoff } }],
      NOT: { wallets: { some: { active: true } } },
    },
    select: { id: true, telegramId: true, nudgeCount: true },
  });

  for (const user of candidates) {
    const message = messages[Math.min(user.nudgeCount, messages.length - 1)];
    if (!message) continue; // unreachable given the messages.length === 0 guard above, but noUncheckedIndexedAccess needs it
    try {
      await sendNudge(bot, user.telegramId, message.content, minDepositUsd);
    } catch (err) {
      log.warn({ err, userId: user.id }, "Re-engagement nudge delivery failed");
    }
    // Count the attempt regardless of delivery outcome — matches
    // notifications.ts's fire-and-forget style, and is what makes "stop
    // after NUDGE_MAX_COUNT" actually stop for a user who's blocked the bot.
    await db.user.update({
      where: { id: user.id },
      data: { nudgeCount: { increment: 1 }, lastNudgedAt: new Date() },
    });
  }
}

/**
 * Recurring re-engagement check for onboarded-but-never-activated users —
 * runs entirely in the bot process (unlike the worker's drawdown/drift jobs)
 * since its only work is a Postgres read and a Telegram send, both already
 * available here; there's no chain/trading logic to justify a worker->bot
 * Redis round-trip. Returns a function to stop it.
 */
export function startReengagementCheck(bot: Bot<BotContext>, intervalMs: number): () => void {
  const timer = setInterval(() => {
    runNudgeCheck(bot).catch((err) => log.error({ err }, "Re-engagement check failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
