import type { Bot } from "grammy";
import { createLogger, loadConfig } from "@clawd/core";
import { createBot, BOT_COMMANDS, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION } from "./bot.js";
import { wireNotifications } from "./notifications.js";
import { startReengagementCheck } from "./reengagement.js";
import type { BotContext } from "./types.js";

const log = createLogger("bot:main");

const STARTUP_METADATA_TIMEOUT_MS = 5000;

/**
 * One-time profile metadata (command menu, description text) — cosmetic,
 * never required for the bot to actually start serving users. A flaky
 * connection to Telegram's API here must never hang startup indefinitely
 * (same class of bug fixed for Pyth/balance fetches — see pyth.ts,
 * wallet-service.ts), so each call gets its own timeout and best-effort
 * failure handling instead of blocking bot.start().
 */
async function setStartupMetadata(bot: Bot<BotContext>): Promise<void> {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["setMyCommands", () => bot.api.setMyCommands(BOT_COMMANDS)],
    ["setMyDescription", () => bot.api.setMyDescription(BOT_DESCRIPTION)],
    ["setMyShortDescription", () => bot.api.setMyShortDescription(BOT_SHORT_DESCRIPTION)],
  ];
  for (const [name, call] of calls) {
    await Promise.race([
      call(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), STARTUP_METADATA_TIMEOUT_MS)),
    ]).catch((err) => {
      log.warn({ err, call: name }, "Startup profile metadata call failed — continuing without it");
    });
  }
}

async function main() {
  const bot = createBot();
  log.info("Connecting to Telegram...");
  await bot.init();
  await setStartupMetadata(bot);
  log.info({ username: bot.botInfo.username }, "Starting Clawd Agents bot");

  const stopNotifications = wireNotifications(bot);
  const cfg = loadConfig();
  const stopReengagement = startReengagementCheck(bot, cfg.NUDGE_CHECK_INTERVAL_MS);

  const shutdown = () => {
    log.info("Shutting down...");
    stopNotifications();
    stopReengagement();
    bot.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await bot.start();
}

main().catch((err) => {
  console.error("Fatal error starting bot:", err);
  process.exit(1);
});
