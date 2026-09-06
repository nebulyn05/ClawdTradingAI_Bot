import type { Conversation } from "@grammyjs/conversations";
import type { Chain } from "@clawd/core";
import type { BotContext } from "../types.js";
import { listWallets, withdrawFromWallet, formatNativeAmount } from "../wallet-service.js";

export async function withdrawConversation(conversation: Conversation<BotContext>, ctx: BotContext) {
  const userId = ctx.userId;
  const presetChain = ctx.session.transferChain;
  ctx.session.transferChain = undefined;

  const wallets = await conversation.external(() => listWallets(userId));
  if (wallets.length === 0) {
    await ctx.reply("You don't have any wallets yet. Run /start first.");
    return;
  }

  let chain: Chain;
  if (presetChain) {
    chain = presetChain;
  } else {
    await ctx.reply(`Which chain? Reply with one of: ${wallets.map((w) => w.chain).join(", ")}`);
    const chainMsg = await conversation.waitFor("message:text");
    chain = chainMsg.message.text.trim().toLowerCase() as Chain;
  }
  const wallet = wallets.find((w) => w.chain === chain);
  if (!wallet) {
    await ctx.reply("You don't have a wallet for that chain.");
    return;
  }

  await ctx.reply("Destination address?");
  const addrMsg = await conversation.waitFor("message:text");
  const toAddress = addrMsg.message.text.trim();

  await ctx.reply(`Amount of native token to withdraw from ${wallet.address}?`);
  const amountMsg = await conversation.waitFor("message:text");
  const amountInput = amountMsg.message.text.trim();

  await ctx.reply("Submitting withdrawal...");
  try {
    const result = await conversation.external(() =>
      withdrawFromWallet(userId, chain, toAddress, amountInput),
    );
    await ctx.reply(
      `Withdrawal ${result.status}. Sent ${formatNativeAmount(chain, BigInt(result.amountIn))} — tx: ${result.txHash}`,
    );
  } catch (err) {
    await ctx.reply(`Withdrawal failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}
