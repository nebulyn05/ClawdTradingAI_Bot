import type { Conversation } from "@grammyjs/conversations";
import { formatTokenAmount, parseTokenAmount } from "@clawd/chains";
import type { BotContext } from "../types.js";
import { getTokenBalanceForWallet, transferTokenFromWallet } from "../wallet-service.js";

/**
 * "Transfer Token" — sends an arbitrary ERC20 (EVM chains) or SPL (Solana)
 * token by contract/mint address, distinct from "Transfer Currency" (native
 * asset, handled by withdrawConversation). Chain is pre-selected via
 * ctx.session.transferChain by the Wallet > Transfer button flow in menu.ts.
 */
export async function transferTokenConversation(conversation: Conversation<BotContext>, ctx: BotContext) {
  const userId = ctx.userId;
  const chain = ctx.session.transferChain;
  ctx.session.transferChain = undefined;
  if (!chain) {
    await ctx.reply("Nothing to transfer — go back to Wallet > Transfer and try again.");
    return;
  }

  await ctx.reply(
    chain === "solana"
      ? "Send the SPL token mint address to transfer."
      : "Send the ERC20 token contract address to transfer.",
  );
  const tokenMsg = await conversation.waitFor("message:text");
  const tokenAddress = tokenMsg.message.text.trim();

  let tokenInfo: { balance: bigint; decimals: number };
  try {
    tokenInfo = await conversation.external(() => getTokenBalanceForWallet(userId, chain, tokenAddress));
  } catch (err) {
    await ctx.reply(`Couldn't read that token: ${err instanceof Error ? err.message : "unknown error"}`);
    return;
  }
  await ctx.reply(`Balance: ${formatTokenAmount(tokenInfo.balance, tokenInfo.decimals)}`);

  await ctx.reply("Destination address?");
  const addrMsg = await conversation.waitFor("message:text");
  const toAddress = addrMsg.message.text.trim();

  await ctx.reply("Amount to send?");
  const amountMsg = await conversation.waitFor("message:text");
  const amountInput = amountMsg.message.text.trim();

  let amountRaw: bigint;
  try {
    amountRaw = parseTokenAmount(amountInput, tokenInfo.decimals);
  } catch (err) {
    await ctx.reply(err instanceof Error ? err.message : "Invalid amount.");
    return;
  }

  await ctx.reply("Submitting transfer...");
  try {
    const result = await conversation.external(() =>
      transferTokenFromWallet(userId, chain, tokenAddress, toAddress, amountRaw),
    );
    await ctx.reply(`Transfer ${result.status} — tx: ${result.txHash}`);
  } catch (err) {
    await ctx.reply(`Transfer failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}
