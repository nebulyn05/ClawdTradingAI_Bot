import { InlineKeyboard } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import { parseTokenAmount } from "@clawd/chains";
import type { BotContext } from "../types.js";
import { CHAIN_ICON, CHAIN_LABEL, NATIVE_SYMBOL } from "../chain-labels.js";
import {
  withdrawFromWallet,
  getStablecoinAddress,
  getTokenBalanceForWallet,
  transferTokenFromWallet,
  type StablecoinSymbol,
} from "../wallet-service.js";
import { renderTransferCurrencyView } from "../menu.js";

/**
 * Steps 2/3 (destination) and 3/3 (amount + submit) of "Transfer Currency" —
 * step 1/3 (currency selection) is a plain button view in menu.ts, which
 * sets ctx.session.transferChain/transferCurrency right before entering
 * this conversation (.enter() takes no extra arguments). Handles both the
 * native asset (via withdrawFromWallet) and an admin-configured stablecoin
 * (via transferTokenFromWallet) — same destination/amount steps either way.
 */
export async function transferCurrencyConversation(conversation: Conversation<BotContext>, ctx: BotContext) {
  const userId = ctx.userId;
  const chain = ctx.session.transferChain;
  const currency = ctx.session.transferCurrency;
  ctx.session.transferChain = undefined;
  ctx.session.transferCurrency = undefined;
  if (!chain || !currency) {
    await ctx.reply("Nothing to transfer — go back to Wallet > Transfer and try again.");
    return;
  }

  const currencyLabel = currency === "native" ? NATIVE_SYMBOL[chain] : currency.toUpperCase();

  await ctx
    .editMessageText(
      "💱 Transfer Currency (2 / 3)\n\n" +
        "👛 Wallet: Primary\n" +
        `🌐 Chain: ${CHAIN_ICON[chain]} ${CHAIN_LABEL[chain]}\n` +
        `👛 Currency: ${currencyLabel}\n\n` +
        "📧 Select destination:",
      { reply_markup: new InlineKeyboard().text("⬅ Back", `wallet:transfer:${chain}:currency`) },
    )
    .catch(() => {});
  await ctx.reply(`📝 Enter the ${CHAIN_LABEL[chain]} address to send ${currencyLabel} to:`);

  const destResult = await conversation.waitFor(["message:text", "callback_query:data"]);
  if (destResult.callbackQuery) {
    await destResult.answerCallbackQuery();
    const { text, keyboard } = await conversation.external(() => renderTransferCurrencyView(userId, chain));
    await destResult.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
    return;
  }
  const toAddress = destResult.message?.text?.trim();
  if (!toAddress) {
    await ctx.reply("Send the destination address as text. Run the transfer again.");
    return;
  }

  await ctx.reply(`💱 Transfer Currency (3 / 3)\n\nAmount of ${currencyLabel} to send?`);
  const amountResult = await conversation.waitFor("message:text");
  const amountInput = amountResult.message.text.trim();

  await ctx.reply("Submitting transfer...");
  try {
    let result;
    if (currency === "native") {
      result = await conversation.external(() => withdrawFromWallet(userId, chain, toAddress, amountInput));
    } else {
      const tokenAddress = await conversation.external(() =>
        getStablecoinAddress(chain, currency as StablecoinSymbol),
      );
      if (!tokenAddress) {
        await ctx.reply(`${currencyLabel} isn't configured on ${CHAIN_LABEL[chain]} anymore. Run the transfer again.`);
        return;
      }
      const info = await conversation.external(() => getTokenBalanceForWallet(userId, chain, tokenAddress));
      const amountRaw = parseTokenAmount(amountInput, info.decimals);
      result = await conversation.external(() =>
        transferTokenFromWallet(userId, chain, tokenAddress, toAddress, amountRaw),
      );
    }
    await ctx.reply(`Transfer ${result.status} — tx: ${result.txHash}`);
  } catch (err) {
    await ctx.reply(`Transfer failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}
