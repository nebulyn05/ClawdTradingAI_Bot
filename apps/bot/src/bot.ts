import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { loadConfig, createLogger, getSetting } from "@clawd/core";
import type { BotContext, SessionData } from "./types.js";
import type { Chain } from "@clawd/core";
import {
  listWallets,
  getOrCreateUser,
  getWalletBalance,
  formatNativeAmount,
  setWalletActive,
  attributeReferral,
  SUPPORTED_CHAINS,
} from "./wallet-service.js";
import { importWalletConversation } from "./conversations/import-wallet.js";
import { exportKeyConversation } from "./conversations/export-key.js";
import { withdrawConversation } from "./conversations/withdraw.js";
import { transferTokenConversation } from "./conversations/transfer-token.js";
import { transferCurrencyConversation } from "./conversations/transfer-currency.js";
import { onboardingConversation } from "./conversations/onboarding.js";
import { customValueEntryConversation } from "./conversations/custom-value-entry.js";
import { customReferralCodeConversation } from "./conversations/custom-referral-code.js";
import { renderMainMenu, renderViewAsMessage, registerMenuHandlers } from "./menu.js";

/** Shown in Telegram's "☰" command menu next to the message box. */
export const BOT_COMMANDS = [
  { command: "start", description: "Dashboard" },
  { command: "wallet", description: "Manage wallet" },
  { command: "settings", description: "Trade settings" },
  { command: "portfolio", description: "Positions & PnL" },
  { command: "info", description: "How Clawd Agents works" },
  { command: "referral", description: "Rewards & referral" },
] as const;

/**
 * Shown on Telegram's pre-chat profile screen (the empty-chat page above the
 * native "START" button, before anyone has sent /start) and, for the short
 * variant, wherever the bot is shared/forwarded. The profile photo/video on
 * that same screen is BotFather-only — there's no Bot API method to set it —
 * so this text is the only part of that screen we can actually control.
 */
export const BOT_DESCRIPTION =
  "⚡ Clawd Agents — your autonomous AI trading agent, live 24/7 across Solana, Ethereum, BSC, " +
  "Base, Monad, and Robinhood Chain.\n\n" +
  "Screens every token for safety, then auto-buys and auto-sells with take-profit/stop-loss on " +
  "every trade. No charts, no contract addresses to paste.\n\n" +
  "Fee: 2% on profitable trades only. Zero on losses.\n\n" +
  "Tap Start to create your wallet and get going.";

export const BOT_SHORT_DESCRIPTION =
  "Autonomous AI trading across 6 chains. Auto safety screening + auto TP/SL. 2% fee on profit only.";

const log = createLogger("bot");

const AD_TIMEOUT_MS = 5000;

/**
 * Sends the admin-configured intro GIF/video (Settings' "Bot: ad video/GIF
 * URL") as its own standalone message, once per /start — matching the
 * reference bot exactly: the GIF appears once right after /start, never
 * attached to every subsequent message. No URL configured -> no-op. A
 * flaky/unreachable media URL must never block /start itself, so this gets
 * the same bounded-timeout, best-effort treatment as the other network calls
 * in this bot (see pyth.ts, wallet-service.ts, main.ts).
 */
async function sendIntroAd(ctx: BotContext): Promise<void> {
  const cfg = loadConfig();
  const url = (await getSetting("BOT_AD_MEDIA_URL")) ?? cfg.BOT_AD_MEDIA_URL;
  if (!url) return;
  await Promise.race([
    ctx.replyWithAnimation(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), AD_TIMEOUT_MS)),
  ]).catch((err) => {
    log.warn({ err, url }, "Failed to send intro ad — continuing without it");
  });
}

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
  bot.use(createConversation(transferTokenConversation, "transferToken"));
  bot.use(createConversation(transferCurrencyConversation, "transferCurrency"));
  bot.use(createConversation(onboardingConversation, "onboarding"));
  bot.use(createConversation(customValueEntryConversation, "customValueEntry"));
  bot.use(createConversation(customReferralCodeConversation, "customReferralCode"));

  // Resolve/create our internal User row for every incoming update before any command runs.
  bot.use(async (ctx, next) => {
    log.info(
      {
        updateId: ctx.update.update_id,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        text: ctx.message?.text,
      },
      "Telegram update received"
    );
    if (!ctx.from) return next();
    const user = await getOrCreateUser(String(ctx.from.id), ctx.from.username);
    ctx.userId = user.id;
    await next();
  });

  registerMenuHandlers(bot);

  // First-time users (no wallets yet) get the onboarding funnel (welcome ->
  // human-check -> pitch -> create/import wallet); returning users go
  // straight to the persistent button menu.
  bot.command("start", async (ctx) => {
    await sendIntroAd(ctx);
    const wallets = await listWallets(ctx.userId);
    if (wallets.length === 0) {
      // Deep-link referral attribution: /start r_<code> (see menu.ts's Rewards
      // Hub, which generates these links). Silently no-ops on an invalid code
      // or if this user already has a referrer — never blocks onboarding.
      const param = ctx.match?.toString().trim() ?? "";
      if (param.startsWith("r_")) {
        await attributeReferral(ctx.userId, param.slice(2)).catch(() => {});
      }
      await ctx.conversation.enter("onboarding");
      return;
    }
    await renderMainMenu(ctx);
  });

  bot.command("wallet", async (ctx) => renderViewAsMessage(ctx, "menu:wallet"));
  bot.command("settings", async (ctx) => renderViewAsMessage(ctx, "menu:settings"));
  bot.command("portfolio", async (ctx) => renderViewAsMessage(ctx, "menu:portfolio"));
  bot.command("info", async (ctx) => renderViewAsMessage(ctx, "menu:info"));
  bot.command("referral", async (ctx) => renderViewAsMessage(ctx, "menu:rewards"));

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "/start — dashboard / onboarding\n" +
        "/wallet — manage wallet (transfer, deposit, import, export, generate)\n" +
        "/settings — trade settings\n" +
        "/portfolio — positions & PnL\n" +
        "/info — how Clawd Agents works\n" +
        "/referral — rewards & referral\n\n" +
        "Power-user commands:\n" +
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
