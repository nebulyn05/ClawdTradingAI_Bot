import type { Conversation } from "@grammyjs/conversations";
import type { Chain } from "@clawd/core";
import type { BotContext } from "../types.js";
import { SUPPORTED_CHAINS, importWalletForUser } from "../wallet-service.js";

export async function importWalletConversation(
  conversation: Conversation<BotContext>,
  ctx: BotContext,
) {
  const userId = ctx.userId;

  await ctx.reply(
    `Which chain? Reply with one of: ${SUPPORTED_CHAINS.join(", ")}\n\n` +
      "(Monad and Robinhood Chain aren't supported yet.)",
  );
  const chainMsg = await conversation.waitFor("message:text");
  const chain = chainMsg.message.text.trim().toLowerCase() as Chain;
  if (!SUPPORTED_CHAINS.includes(chain)) {
    await ctx.reply("Not a supported chain. Run /import again to retry.");
    return;
  }

  await ctx.reply(
    "Send the raw private key to import.\n\n" +
      "⚠️ Only do this in this private chat, never in a group. I'll try to delete your message " +
      "immediately after reading it, but treat the key as compromised once sent over any network — " +
      "consider it burned and move funds if this wasn't your intent.",
  );
  const keyMsg = await conversation.waitFor("message:text");
  const rawKey = keyMsg.message.text.trim();

  // Best-effort cleanup of the plaintext key from the chat transcript.
  await conversation.external(async () => {
    try {
      await ctx.api.deleteMessage(keyMsg.chat.id, keyMsg.message.message_id);
    } catch {
      // Bot may lack delete permission (e.g. message older than 48h) — non-fatal.
    }
  });

  try {
    const wallet = await conversation.external(() => importWalletForUser(userId, chain, rawKey));
    await ctx.reply(`Imported ${chain} wallet: ${wallet.address}`);
  } catch (err) {
    await ctx.reply(`Import failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}
