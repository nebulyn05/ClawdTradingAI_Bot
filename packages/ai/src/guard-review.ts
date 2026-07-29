import { createLogger, type Chain, type SafetyCheckResult } from "@clawd/core";
import { askClaude, isAiEnabled } from "./client.js";
import { extractJson } from "./json.js";

const log = createLogger("ai:guard-review");

export interface AiRiskReview {
  approved: boolean;
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a risk-review gate for an autonomous crypto trading bot. You will be given the results of automated safety checks already run on a token (liquidity, mint/freeze authority, honeypot, holder concentration, etc). Your job is NOT to re-run those checks — trust them. Your job is to catch anything the mechanical checks would miss: a suspicious name/symbol pattern (impersonation of a known project), or anything else that reads as a scam pattern beyond what the mechanical score already captures.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"approved": boolean, "confidence": number between 0 and 1, "reasoning": "one or two sentences"}

Default to approved:true unless you see a specific, nameable red flag beyond what the mechanical checks already covered — you are a final sanity check, not a second independent screen. When genuinely unsure, still set approved:true with lower confidence; only set approved:false for a concrete reason you can state in your reasoning.`;

/**
 * The final qualitative gate before Router executes a buy — runs only after
 * the mechanical Guard checks (rules.ts) have already passed. Fails safe:
 * disabled AI defers entirely to the mechanical result (approved:true, since
 * the mechanical pass already happened); an AI call that errors or returns
 * something unparseable defaults to approved:false rather than silently
 * waving the trade through.
 */
export async function reviewTokenWithAi(
  chain: Chain,
  tokenAddress: string,
  mechanicalResult: SafetyCheckResult,
): Promise<AiRiskReview> {
  if (!isAiEnabled()) {
    return {
      approved: true,
      confidence: 1,
      reasoning: "AI features disabled — deferring to mechanical checks only.",
    };
  }

  const userMessage =
    `Chain: ${chain}\nToken address: ${tokenAddress}\n` +
    `Mechanical score: ${mechanicalResult.score}/100\n` +
    `Checks: ${JSON.stringify(mechanicalResult.checks)}\n` +
    `Reasons flagged: ${mechanicalResult.reasons.join("; ") || "none"}`;

  try {
    const text = await askClaude(SYSTEM_PROMPT, userMessage, 300);
    const parsed = extractJson<AiRiskReview>(text);
    if (!parsed || typeof parsed.approved !== "boolean") {
      log.warn({ text }, "AI review returned unparseable output — defaulting to not-approved");
      return { approved: false, confidence: 0, reasoning: "AI response could not be parsed — failing safe." };
    }
    return parsed;
  } catch (err) {
    log.warn({ err, chain, tokenAddress }, "AI review call failed — defaulting to not-approved");
    return { approved: false, confidence: 0, reasoning: "AI review call failed — failing safe." };
  }
}
