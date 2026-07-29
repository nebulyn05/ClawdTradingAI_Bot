import { createLogger } from "@clawd/core";
import { askClaude, isAiEnabled, extractJson } from "@clawd/ai";

const log = createLogger("scout:interpret");

export interface TweetInterpretation {
  contractAddress: string | null;
  sentiment: "bullish" | "bearish" | "neutral";
  conviction: number;
}

const SYSTEM_PROMPT = `You extract trading signals from a single tweet by a crypto "KOL" (key opinion leader). Look for a contract address (a Solana base58 address ~32-44 chars, or an EVM 0x-prefixed 40-hex-char address) being called out as a token to buy, and the tweet's sentiment/conviction about it.

Respond with ONLY a JSON object, no other text:
{"contractAddress": string or null, "sentiment": "bullish" | "bearish" | "neutral", "conviction": number between 0 and 1}

If there's no contract address in the tweet, contractAddress must be null. Conviction should reflect how strongly/specifically the tweet calls out this exact token — a vague market comment is low conviction; "just aped into $TOKEN, contract below" is high conviction.`;

/** LLM interpretation of one tweet's text. Returns null when AI is disabled, or on any failure. */
export async function interpretTweet(text: string): Promise<TweetInterpretation | null> {
  if (!isAiEnabled()) return null;
  try {
    const response = await askClaude(SYSTEM_PROMPT, text, 200);
    const parsed = extractJson<TweetInterpretation>(response);
    if (!parsed || typeof parsed.sentiment !== "string") return null;
    return parsed;
  } catch (err) {
    log.warn({ err }, "Tweet interpretation failed");
    return null;
  }
}
