import { createServer } from "node:http";
import type { Bot } from "grammy";

import { createLogger, loadConfig } from "@clawd/core";
import {
  createBot,
  BOT_COMMANDS,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
} from "./bot.js";

import { wireNotifications } from "./notifications.js";
import { startReengagementCheck } from "./reengagement.js";

import type { BotContext } from "./types.js";

const log = createLogger("bot:main");

const STARTUP_METADATA_TIMEOUT_MS = 5000;

async function setStartupMetadata(bot: Bot<BotContext>): Promise<void> {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["setMyCommands", () => bot.api.setMyCommands(BOT_COMMANDS)],
    ["setMyDescription", () => bot.api.setMyDescription(BOT_DESCRIPTION)],
    ["setMyShortDescription", () =>
      bot.api.setMyShortDescription(BOT_SHORT_DESCRIPTION)
    ],
  ];

  for (const [name, call] of calls) {
    await Promise.race([
      call(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("timed out")),
          STARTUP_METADATA_TIMEOUT_MS
        )
      ),
    ]).catch((err) => {
      log.warn(
        { err, call: name },
        "Startup profile metadata call failed — continuing without it"
      );
    });
  }
}

async function main() {
  /*
   * Render Web Service health server
   */
  const port = Number(process.env.PORT || 3000);

  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          status: "ok",
          service: "clawd-bot",
        })
      );

      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        error: "Not found",
      })
    );
  });

  server.listen(port, "0.0.0.0", () => {
    log.info({ port }, "HTTP health server listening");
  });

  /*
   * Telegram bot
   */
  const bot = createBot();

  log.info("Connecting to Telegram...");

  await bot.init();

  await setStartupMetadata(bot);

  log.info(
    { username: bot.botInfo.username },
    "Starting Clawd Agents bot"
  );

  const stopNotifications = wireNotifications(bot);

  const cfg = loadConfig();

  const stopReengagement = startReengagementCheck(
    bot,
    cfg.NUDGE_CHECK_INTERVAL_MS
  );

  const shutdown = () => {
    log.info("Shutting down...");

    stopNotifications();
    stopReengagement();

    bot.stop();

    server.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await bot.start();
}

main().catch((err) => {
  console.error("Fatal error starting bot:", err);
  process.exit(1);
});
