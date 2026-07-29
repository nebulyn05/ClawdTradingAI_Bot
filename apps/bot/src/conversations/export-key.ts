import type { Conversation } from "@grammyjs/conversations";
import type { Chain } from "@clawd/core";
import type { BotContext } from "../types.js";
import {
  SUPPORTED_CHAINS,
  hasExportPassphrase,
  setExportPassphrase,
  checkExportPassphrase,
  exportWalletKey,
  listWallets,
} from "../wallet-service.js";

const REVEAL_TTL_SECONDS = 60;

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
  await ctx.reply(`Which chain? Reply with one of: ${wallets.map((w) => w.chain).join(", ")}`);
  const chainMsg = await conversation.waitFor("message:text");
  const chain = chainMsg.message.text.trim().toLowerCase() as Chain;
  if (!SUPPORTED_CHAINS.includes(chain) || !wallets.some((w) => w.chain === chain)) {
    await ctx.reply("You don't have a wallet for that chain.");
    return;
  }

  const rawKey = await conversation.external(() => exportWalletKey(userId, chain));
  const sent = await ctx.reply(
    `Raw private key for your ${chain} wallet:\n\n${rawKey}\n\n` +
      `This message will be deleted in ${REVEAL_TTL_SECONDS}s — copy it now and store it somewhere safe.`,
  );

  // Fire-and-forget: only cleans up if the bot process stays alive for the TTL window.
  conversation.external(() => {
    setTimeout(() => {
      ctx.api.deleteMessage(sent.chat.id, sent.message_id).catch(() => {});
    }, REVEAL_TTL_SECONDS * 1000);
  });
}
