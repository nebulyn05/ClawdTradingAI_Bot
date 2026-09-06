import { InlineKeyboard } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../types.js";
import { importDetectedWallet } from "../wallet-service.js";

const IMPORT_PROMPT_TEXT =
  "⬇️ Import Your Wallet\n" +
  "Seamlessly connect your existing wallet to Clawd Agents.\n\n" +
  "Accepted Formats:\n" +
  "EVM Private Key — e.g. 0xac0974bec39a17e36ba4... (64-char hex)\n" +
  "Phantom — e.g. 5AMLJ8NzbP25FcbcUettpzJLYTw3... (base58)\n" +
  "Solflare / Backpack — e.g. [12, 45, 78, ...] (JSON array)\n" +
  "Mnemonic Phrase — e.g. apple lake ghost forward... (12, 15, 18, 21, or 24 words)\n\n" +
  "🔒 Security: Encrypted immediately · Message auto-deleted · Never stored in plain text\n\n" +
  "Send your private key or seed phrase below to proceed.";

const INVALID_KEY_TEXT =
  "🔴 Invalid private key.\n\n" +
  "The credential you entered is not recognized.\n\n" +
  "Supported formats:\n" +
  "• BIP39 seed phrase (12, 15, 18, 21, or 24 words)\n" +
  "• EVM private key (64 hex chars, with or without 0x)\n" +
  "• Solana secret key (base58, 64-byte — Phantom/Solflare/Backpack export)\n" +
  "• Solana CLI keypair (JSON array)\n\n" +
  "Check for typos and try again.";

function invalidKeyKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🔄 Try again", "wallet:import:retry").text("⬅ Cancel", "wallet:import:cancel");
}

/**
 * Auto-detects the pasted secret's format instead of asking "which chain?"
 * first — see @clawd/wallet's detectImportMaterial. An EVM key replaces the
 * shared address on all 5 EVM chain rows; a Solana key (base58 or JSON
 * array) replaces the Solana row; a mnemonic replaces both. Loops on an
 * unrecognized format (rather than ending the conversation) so a typo
 * doesn't force the user to re-run /import from scratch.
 */
export async function importWalletConversation(
  conversation: Conversation<BotContext>,
  ctx: BotContext,
) {
  const userId = ctx.userId;

  await ctx.reply(IMPORT_PROMPT_TEXT, { reply_markup: new InlineKeyboard().text("❌ Cancel", "wallet:import:cancel") });

  for (;;) {
    const result = await conversation.waitFor(["message:text", "callback_query:data"]);

    if (result.callbackQuery) {
      await result.answerCallbackQuery();
      if (result.callbackQuery.data === "wallet:import:retry") {
        await result.editMessageText(IMPORT_PROMPT_TEXT, {
          reply_markup: new InlineKeyboard().text("❌ Cancel", "wallet:import:cancel"),
        }).catch(() => {});
        continue;
      }
      // "wallet:import:cancel" or anything else — end the flow.
      await result.deleteMessage().catch(() => {});
      return;
    }

    const secret = result.message?.text?.trim();
    if (!secret) continue;
    const messageChatId = result.chat!.id;
    const messageId = result.message!.message_id;

    // Best-effort cleanup of the plaintext key/phrase from the chat transcript.
    await conversation.external(async () => {
      try {
        await ctx.api.deleteMessage(messageChatId, messageId);
      } catch {
        // Bot may lack delete permission (e.g. message older than 48h) — non-fatal.
      }
    });

    try {
      const imported = await conversation.external(() => importDetectedWallet(userId, secret));
      const label =
        imported.kind === "evm"
          ? "EVM wallet (Ethereum, BSC, Base, Monad, Robinhood)"
          : imported.kind === "solana"
            ? "Solana wallet"
            : "EVM + Solana wallets";
      await ctx.reply(`✅ Imported your ${label}. Balances update on the Wallet screen.`);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      if (message.startsWith("Unrecognized format")) {
        await ctx.reply(INVALID_KEY_TEXT, { reply_markup: invalidKeyKeyboard() });
        continue;
      }
      await ctx.reply(`Import failed: ${message}`);
      return;
    }
  }
}
