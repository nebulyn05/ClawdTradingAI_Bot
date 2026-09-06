import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../types.js";
import { parseNativeAmount, setBuyAmountOverride, setSlippageOverride } from "../wallet-service.js";
import { renderSlippageChainView, renderBuyAmountValueView } from "../menu.js";

/**
 * Free-text "Custom" value entry for Settings' Slippage/Buy Amount screens —
 * the preset buttons cover the common cases, this covers everything else.
 * Reads `ctx.session.customEntry` (stashed by the "✏️ Custom" button handler
 * in menu.ts right before entering this conversation) since
 * @grammyjs/conversations' `.enter()` takes no extra arguments.
 */
export async function customValueEntryConversation(conversation: Conversation<BotContext>, ctx: BotContext) {
  const userId = ctx.userId;
  const target = ctx.session.customEntry;
  ctx.session.customEntry = undefined;
  if (!target) {
    await ctx.reply("Nothing to set — go back to Settings and tap Custom again.");
    return;
  }

  if (target.kind === "slippage") {
    const { chain, side } = target;
    await ctx.reply(
      `Send the custom slippage for ${chain} ${side.toUpperCase()} as a percentage, e.g. "3" or "3.5" for 3.5%.`,
    );
    const msg = await conversation.waitFor("message:text");
    const raw = msg.message.text.trim().replace("%", "");
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      await ctx.reply("Not a valid percentage (0-50). Go back to Settings and tap Custom again.");
      return;
    }
    const bps = Math.round(pct * 100);
    await conversation.external(() => setSlippageOverride(userId, chain, side, bps));
    const { text, keyboard } = await conversation.external(() => renderSlippageChainView(userId, chain));
    await ctx.reply(text, { reply_markup: keyboard });
    return;
  }

  const { chain } = target;
  await ctx.reply(`Send the custom buy amount for ${chain}, e.g. "0.25".`);
  const msg = await conversation.waitFor("message:text");
  const raw = msg.message.text.trim();
  try {
    parseNativeAmount(chain, raw);
  } catch {
    await ctx.reply("Not a valid amount. Go back to Settings and tap Custom again.");
    return;
  }
  await conversation.external(() => setBuyAmountOverride(userId, chain, raw));
  const { text, keyboard } = renderBuyAmountValueView(chain, raw);
  await ctx.reply(text, { reply_markup: keyboard });
}
