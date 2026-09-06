import { createLogger, type Chain } from "@clawd/core";
import { askClaude, isAiEnabled } from "./client.js";
import { extractJson } from "./json.js";

const log = createLogger("ai:tp-sl-review");

export interface AiTpSlReview {
  takeProfitPct: number;
  stopLossPct: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You advise take-profit and stop-loss levels for an open crypto position, as fractional percentages above/below entry price. You'll be given the entry price, current price, how long the position has been open, and the token's current safety score. Respond with ONLY a JSON object:
{"takeProfitPct": number (e.g. 0.5 means +50%), "stopLossPct": number (e.g. 0.2 means -20%), "reasoning": "one sentence"}
Keep takeProfitPct between 0.1 and 5, stopLossPct between 0.05 and 0.9. Widen both for a token showing strong momentum that still scores well on safety; tighten stopLossPct for one whose safety score has dropped since entry.`;

/**
 * Periodic (not per-tick) re-evaluation of an open position's TP/SL targets.
 * This is an optimization, not a safety gate, so failure degrades to "keep
 * the current targets" (null) rather than failing closed — there's nothing
 * unsafe about leaving the existing percentage-based targets in place.
 */
export async function reviewTpSlWithAi(
  chain: Chain,
  entryPrice: number,
  currentPrice: number,
  currentTakeProfitPct: number,
  currentStopLossPct: number,
  safetyScore: number,
  openForMs: number,
): Promise<AiTpSlReview | null> {
  if (!(await isAiEnabled())) return null;

  const userMessage =
    `Chain: ${chain}\nEntry price: ${entryPrice}\nCurrent price: ${currentPrice}\n` +
    `Current TP: +${(currentTakeProfitPct * 100).toFixed(0)}% · SL: -${(currentStopLossPct * 100).toFixed(0)}%\n` +
    `Safety score: ${safetyScore}/100\nOpen for: ${Math.round(openForMs / 60_000)} minutes`;

  try {
    const text = await askClaude(SYSTEM_PROMPT, userMessage, 300);
    const parsed = extractJson<AiTpSlReview>(text);
    if (!parsed || typeof parsed.takeProfitPct !== "number" || typeof parsed.stopLossPct !== "number") {
      log.warn({ text }, "AI TP/SL review returned unparseable output — keeping current targets");
      return null;
    }
    return {
      takeProfitPct: Math.min(5, Math.max(0.1, parsed.takeProfitPct)),
      stopLossPct: Math.min(0.9, Math.max(0.05, parsed.stopLossPct)),
      reasoning: parsed.reasoning ?? "",
    };
  } catch (err) {
    log.warn({ err, chain }, "AI TP/SL review call failed — keeping current targets");
    return null;
  }
}
