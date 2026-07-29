import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { loadConfig, createLogger } from "@clawd/core";
import type { BotContext, SessionData } from "./types.js";
import type { Chain } from "@clawd/core";
import {
  ensureWalletsForUser,
  listWallets,
  getOrCreateUser,
  getWalletBalance,
  formatNativeAmount,
  setWalletActive,
  SUPPORTED_CHAINS,
} from "./wallet-service.js";
import { importWalletConversation } from "./conversations/import-wallet.js";
import { exportKeyConversation } from "./conversations/export-key.js";
import { withdrawConversation } from "./conversations/withdraw.js";

const log = createLogger("bot");

export function createBot(): Bot<BotContext> {
  const { TELEGRAM_BOT_TOKEN } = loadConfig();
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set. Create a bot via @BotFather on Telegram and set it in .env",
    );
  }

  const bot = new Bot<BotContext>(TELEGRAM_BOT_TOKEN);

  bot.use(session({ initial: (): SessionData => ({}) }));
  bot.use(conversations());
  bot.use(createConversation(importWalletConversation, "importWallet"));
  bot.use(createConversation(exportKeyConversation, "exportKey"));
  bot.use(createConversation(withdrawConversation, "withdraw"));

  // Resolve/create our internal User row for every incoming update before any command runs.
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const user = await getOrCreateUser(String(ctx.from.id), ctx.from.username);
    ctx.userId = user.id;
    await next();
  });

  bot.command("start", async (ctx) => {
    const created = await ensureWalletsForUser(ctx.userId);
    const wallets = await listWallets(ctx.userId);
    const lines = wallets.map((w) => `• ${w.chain} (${w.network}): ${w.address}`);
    await ctx.reply(
      "Welcome to Clawd Agents — your autonomous trading agent.\n\n" +
        (created.length > 0 ? `Created ${created.length} new wallet(s).\n\n` : "") +
        `Your wallets:\n${lines.join("\n")}\n\n` +
        "Deposit funds to the address for the chain you want to trade on.\n\n" +
        "Commands:\n" +
        "/wallets — list your wallets and live balances\n" +
        "/import — import an existing wallet instead of a generated one\n" +
        "/export — export a wallet's raw private key\n" +
        "/withdraw — send native tokens out to another address\n" +
        "/deploy <chain> — let the bot auto-trade that wallet\n" +
        "/pause <chain> — stop auto-trading that wallet\n" +
        "/help — show this again",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "/start — onboarding + show wallets\n" +
        "/wallets — list your wallets and live balances\n" +
        "/import — import an existing wallet\n" +
        "/export — export a raw private key (requires a passphrase)\n" +
        "/withdraw — send native tokens out to another address\n" +
        "/deploy <chain> — let the bot auto-trade that wallet\n" +
        "/pause <chain> — stop auto-trading that wallet",
    );
  });

  bot.command("wallets", async (ctx) => {
    const wallets = await listWallets(ctx.userId);
    if (wallets.length === 0) {
      await ctx.reply("No wallets yet. Run /start to create them.");
      return;
    }
    await ctx.reply("Fetching balances...");
    const lines = await Promise.all(
      wallets.map(async (w) => {
        const status = w.active ? "🟢 deployed" : "⚪ paused";
        try {
          const balance = await getWalletBalance(ctx.userId, w.chain);
          return `• ${w.chain} (${w.network}) ${status}: ${w.address}\n   balance: ${formatNativeAmount(w.chain, balance)}`;
        } catch (err) {
          return `• ${w.chain} (${w.network}) ${status}: ${w.address}\n   balance: unavailable (${err instanceof Error ? err.message : "error"})`;
        }
      }),
    );
    await ctx.reply(lines.join("\n"));
  });

  const setDeployState = (active: boolean) => async (ctx: BotContext) => {
    const chain = ctx.match?.toString().trim().toLowerCase() as Chain | undefined;
    if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
      await ctx.reply(
        `Usage: /${active ? "deploy" : "pause"} <chain> — one of: ${SUPPORTED_CHAINS.join(", ")}`,
      );
      return;
    }
    try {
      await setWalletActive(ctx.userId, chain, active);
      await ctx.reply(
        active
          ? `${chain} wallet deployed — Sniper/Guard/Router will auto-trade it now.`
          : `${chain} wallet paused — no new auto-trades will open on it.`,
      );
    } catch (err) {
      await ctx.reply(`Failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };

  bot.command("deploy", setDeployState(true));
  bot.command("pause", setDeployState(false));

  bot.command("import", async (ctx) => {
    await ctx.conversation.enter("importWallet");
  });

  bot.command("export", async (ctx) => {
    await ctx.conversation.enter("exportKey");
  });

  bot.command("withdraw", async (ctx) => {
    await ctx.conversation.enter("withdraw");
  });

  bot.catch((err) => {
    log.error({ err: err.error }, "Unhandled bot error");
  });

  return bot;
}
