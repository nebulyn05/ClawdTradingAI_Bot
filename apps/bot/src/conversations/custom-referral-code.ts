import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../types.js";
import { setCustomReferralCode } from "../wallet-service.js";
import { renderRewardsView } from "../menu.js";

/** Rewards Hub's "✏️ Custom Code" — replaces the auto-derived referral code with a user-chosen one. */
export async function customReferralCodeConversation(conversation: Conversation<BotContext>, ctx: BotContext) {
  const userId = ctx.userId;

  await ctx.reply("Send your custom referral code — 3 to 20 characters: letters, numbers, underscore only.");
  const result = await conversation.waitFor("message:text");
  const code = result.message.text.trim();

  const outcome = await conversation.external(() => setCustomReferralCode(userId, code));
  if (!outcome.ok) {
    await ctx.reply(outcome.error ?? "Failed to set code. Run it again from Rewards.");
    return;
  }

  const botUsername = ctx.me?.username;
  const { text, keyboard } = await conversation.external(() => renderRewardsView(userId, botUsername));
  await ctx.reply(text, { reply_markup: keyboard });
}
