import { createLogger } from "@clawd/core";
import { createBot } from "./bot.js";
import { wireNotifications } from "./notifications.js";

const log = createLogger("bot:main");

async function main() {
  const bot = createBot();
  await bot.init();
  log.info({ username: bot.botInfo.username }, "Starting Clawd Agents bot");

  const stopNotifications = wireNotifications(bot);

  const shutdown = () => {
    log.info("Shutting down...");
    stopNotifications();
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
