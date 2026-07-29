import type { Context, SessionFlavor } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";

// No custom session fields needed yet — @grammyjs/conversations stores its
// own state inside the session via ConversationFlavor.
export type SessionData = Record<string, never>;

export interface ClawdFlavor {
  /** Our internal User.id, attached by the identifyUser middleware before any command runs. */
  userId: string;
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor & ClawdFlavor;
