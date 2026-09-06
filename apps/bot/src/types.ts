import type { Context, SessionFlavor } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";
import type { Chain } from "@clawd/core";

/** What the customValueEntry conversation is currently collecting a value for — set right before entering it, since @grammyjs/conversations' .enter() takes no extra arguments. */
export type CustomEntryTarget =
  | { kind: "slippage"; chain: Chain; side: "buy" | "sell" }
  | { kind: "buyamount"; chain: Chain };

export interface SessionData {
  customEntry?: CustomEntryTarget;
  /** Chain pre-selected via the Wallet > Transfer button flow — read once by withdrawConversation/transferTokenConversation/transferCurrencyConversation, then cleared, since .enter() takes no extra arguments. */
  transferChain?: Chain;
  /** Currency pre-selected via the Wallet > Transfer > Transfer Currency button flow — read once by transferCurrencyConversation, then cleared. */
  transferCurrency?: "native" | "usdc" | "usdt";
}

export interface ClawdFlavor {
  /** Our internal User.id, attached by the identifyUser middleware before any command runs. */
  userId: string;
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor & ClawdFlavor;
