import { InlineKeyboard } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import { loadConfig } from "@clawd/core";
import type { BotContext } from "../types.js";
import {
  hasExportPassphrase,
  setExportPassphrase,
  checkExportPassphrase,
  exportAllWalletKeys,
  listWallets,
} from "../wallet-service.js";

export async function exportKeyConversation(
  conversation: Conversation<BotContext>,
  ctx: BotContext,
) {
  const userId = ctx.userId;
  const hasPassphrase = await conversation.external(() => hasExportPassphrase(userId));

  if (!hasPassphrase) {
    await ctx.reply(
      "You don't have an export passphrase set yet. This passphrase (not your Telegram " +
        "password) is required every time you export a raw private key — set one now.\n\n" +
        "Send the passphrase you want to use:",
    );
    const first = await conversation.waitFor("message:text");
    const passphrase = first.message.text.trim();
    if (passphrase.length < 8) {
      await ctx.reply("Passphrase must be at least 8 characters. Run /export again to retry.");
      return;
    }
    await ctx.reply("Confirm it by sending it again:");
    const confirm = await conversation.waitFor("message:text");
    if (confirm.message.text.trim() !== passphrase) {
      await ctx.reply("Passphrases didn't match. Run /export again to retry.");
      return;
    }
    await conversation.external(() => setExportPassphrase(userId, passphrase));
    await ctx.reply("Export passphrase set. Continuing to export...");
  }

  await ctx.reply("Enter your export passphrase to continue:");
  const passMsg = await conversation.waitFor("message:text");
  const ok = await conversation.external(() =>
    checkExportPassphrase(userId, passMsg.message.text.trim()),
  );
  if (!ok) {
    await ctx.reply("Incorrect passphrase. Export aborted.");
    return;
  }

  const wallets = await conversation.external(() => listWallets(userId));
  if (wallets.length === 0) {
    await ctx.reply("You don't have any wallets yet. Run /start first.");
    return;
  }

  const { evm, solana } = await conversation.external(() => exportAllWalletKeys(userId));
  const cfg = await conversation.external(() => loadConfig());
  const ttlSeconds = cfg.KEY_REVEAL_AUTO_DELETE_SECONDS;

  const keyLines = [
    evm ? `EVM Private Key:\n${evm}` : null,
    solana ? `SOL Private Key:\n${solana}` : null,
  ].filter((l): l is string => l !== null);

  const sent = await ctx.reply(
    `🔐 Your Private Keys\n\n${keyLines.join("\n\n")}\n\n` +
      "⚠️ This gives FULL access to all your funds.\n" +
      "🚫 DELETE THIS MESSAGE immediately after copying.\n" +
      "🚨 Never share with anyone, including support.\n\n" +
      `Auto-deletes in ${Math.round(ttlSeconds / 60)} minutes.`,
    { reply_markup: new InlineKeyboard().text("🗑️ Delete this message", "onboarding:delete_keys") },
  );

  // Fire-and-forget: only cleans up if the bot process stays alive for the TTL window. The
  // message also has a manual "delete now" button (handled in menu.ts) for early cleanup.
  conversation.external(() => {
    setTimeout(() => {
      ctx.api.deleteMessage(sent.chat.id, sent.message_id).catch(() => {});
    }, ttlSeconds * 1000);
  });
}
