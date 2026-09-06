import { InlineKeyboard } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import { loadConfig } from "@clawd/core";
import type { BotContext } from "../types.js";
import { createWalletsForOnboarding, listWallets } from "../wallet-service.js";
import { renderMainMenu } from "../menu.js";

const WELCOME_TEXT =
  "🎯 Welcome to Clawd Agents\n\n" +
  "Your autonomous AI trading agent, running 24/7 across 6 chains — Solana, Ethereum, BSC, " +
  "Base, Monad, and Robinhood Chain. Clawd screens tokens for safety, then enters and exits " +
  "for you automatically with take-profit/stop-loss on every trade. No charts, no contract " +
  "addresses to paste.\n\n" +
  "One quick tap to confirm you're human, and you're in.";

const PITCH_TEXT =
  "What you get:\n" +
  "✅ Early entries on high-potential tokens across 6 chains\n" +
  "✅ Automated buys and sells with full position management\n" +
  "✅ Take-profit and stop-loss working on every trade\n" +
  "✅ Portfolio exposure cap, dynamic position sizing, and a drawdown circuit breaker\n" +
  "✅ MEV-protected execution available (Jito/Flashbots, when enabled)\n\n" +
  "Fee: 2% on profitable trades only. Zero on losses.\n\n" +
  "New here? Create or import your wallet below, and your agent takes it from there.";

/**
 * First-time-user funnel: welcome → human-check button → pitch → Create/Import
 * Wallet buttons. Only entered when the user has zero wallets (see bot.ts's
 * /start) — returning users go straight to the main menu.
 */
export async function onboardingConversation(conversation: Conversation<BotContext>, ctx: BotContext) {
  const userId = ctx.userId;

  await ctx.reply(WELCOME_TEXT, {
    reply_markup: new InlineKeyboard().text("✅ I'm human · Continue", "onboarding:human_ok"),
  });
  const humanCheck = await conversation.waitForCallbackQuery("onboarding:human_ok");
  await humanCheck.answerCallbackQuery();
  await humanCheck.deleteMessage().catch(() => {});

  await ctx.reply(PITCH_TEXT, {
    reply_markup: new InlineKeyboard()
      .text("🔑 Create Wallet", "onboarding:create")
      .text("📥 Import Wallet", "onboarding:import"),
  });
  const choice = await conversation.waitForCallbackQuery(["onboarding:create", "onboarding:import"]);
  await choice.answerCallbackQuery();

  if (choice.callbackQuery.data === "onboarding:import") {
    await ctx.reply(
      "Run /import to import an existing wallet — repeat it once per chain you want to add. " +
        "Once you have at least one wallet, /start again to see your menu.",
    );
    return;
  }

  await ctx.reply("🔑 Generating your wallets...\n\nThis will take just a moment.");

  const { rawKeys } = await conversation.external(() => createWalletsForOnboarding(userId));
  const wallets = await conversation.external(() => listWallets(userId));
  const evmWallet = wallets.find((w) => w.chain !== "solana");
  const solWallet = wallets.find((w) => w.chain === "solana");

  const addressLines = [
    evmWallet ? `EVM: ${evmWallet.address}` : null,
    solWallet ? `SOL: ${solWallet.address}` : null,
  ].filter((l): l is string => l !== null);

  await ctx.reply(`Wallet Generated\n\n${addressLines.join("\n")}`);
  await renderMainMenu(ctx);

  if (rawKeys.evm || rawKeys.solana) {
    const cfg = await conversation.external(() => loadConfig());
    const ttlSeconds = cfg.KEY_REVEAL_AUTO_DELETE_SECONDS;

    const keyLines = [
      rawKeys.evm ? `EVM Private Key:\n${rawKeys.evm}` : null,
      rawKeys.solana ? `SOL Private Key:\n${rawKeys.solana}` : null,
    ].filter((l): l is string => l !== null);

    const sent = await ctx.reply(
      `🔐 Your Private Keys · Save Now\n\n${keyLines.join("\n\n")}\n\n` +
        "⚠️ Write it down. Never screenshot. Never share.\n" +
        `Auto-deletes in ${Math.round(ttlSeconds / 60)} minutes.`,
      { reply_markup: new InlineKeyboard().text("🗑️ Saved. Delete now.", "onboarding:delete_keys") },
    );

    // Fire-and-forget, same mechanism as /export's reveal (export-key.ts) — only
    // cleans up if the bot process stays alive for the TTL window. The message
    // also has a manual "delete now" button (handled in menu.ts) for early cleanup.
    conversation.external(() => {
      setTimeout(() => {
        ctx.api.deleteMessage(sent.chat.id, sent.message_id).catch(() => {});
      }, ttlSeconds * 1000);
    });
  }
}
