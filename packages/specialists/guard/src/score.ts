import { eventBus, createLogger, type Chain, type SafetyCheckResult } from "@clawd/core";
import { getDb } from "@clawd/db";
import { getBestPair } from "@clawd/pricing";
import { isEvmChain } from "@clawd/chains";
import { reviewTokenWithAi, isAiEnabled, AI_GUARD_PROMPT_VERSION } from "@clawd/ai";
import { getEvmTokenSecurity, getSolanaTokenSecurity, GOPLUS_EVM_CHAIN_IDS } from "./goplus.js";
import { computeSolanaScore, computeEvmScore, GUARD_RULE_VERSION, type ScoreResult } from "./rules.js";

const log = createLogger("guard:score");

/**
 * Runs every safety check for `tokenAddress` on `chain` and returns a
 * 0-100 score plus pass/fail. Persists the result to SafetyCheck (cache)
 * and emits `guard.result` / `guard.rejected` on the event bus.
 *
 * Data-source outages (e.g. GoPlus has little testnet coverage) degrade the
 * score with a documented reason rather than hard-failing — otherwise
 * nothing would ever pass Guard while developing against testnets. See
 * rules.ts for the actual scoring logic.
 *
 * If the mechanical checks pass, one more gate runs: an AI qualitative
 * review (packages/ai/src/guard-review.ts). This is the final say — a
 * mechanical pass with an AI rejection is an overall rejection. When AI
 * features are disabled (the default), that review is a no-op pass-through.
 */
export async function screenToken(chain: Chain, tokenAddress: string): Promise<SafetyCheckResult> {
  const pair = await getBestPair(chain, tokenAddress).catch((err) => {
    log.warn({ err, chain, tokenAddress }, "DexScreener lookup failed");
    return null;
  });
  const liquidityUsd = pair?.liquidity?.usd ?? 0;

  let scored: ScoreResult;
  if (chain === "solana") {
    scored = computeSolanaScore(liquidityUsd, await getSolanaTokenSecurity(tokenAddress));
  } else if (isEvmChain(chain)) {
    scored = computeEvmScore(liquidityUsd, await getEvmTokenSecurity(GOPLUS_EVM_CHAIN_IDS[chain], tokenAddress));
  } else {
    scored = { checks: {}, reasons: [`No Guard rules defined for chain "${chain}"`], score: 0, passed: false };
  }

  // Captured before the AI-gate block below can flip `scored`, so the
  // persisted aiPromptVersion reflects whether the real model was actually
  // called — not just whether the (possibly disabled-AI stub) review ran.
  const aiRan = scored.passed && (await isAiEnabled());

  if (scored.passed) {
    const preliminary: SafetyCheckResult = { chain, tokenAddress, checkedAt: Date.now(), ...scored };
    const aiReview = await reviewTokenWithAi(chain, tokenAddress, preliminary);
    scored = {
      ...scored,
      checks: { ...scored.checks, aiReviewApproved: aiReview.approved },
      passed: aiReview.approved,
      reasons: aiReview.approved ? scored.reasons : [...scored.reasons, `AI review: ${aiReview.reasoning}`],
    };
  }

  const result: SafetyCheckResult = { chain, tokenAddress, checkedAt: Date.now(), ...scored };
  const aiPromptVersion = aiRan ? AI_GUARD_PROMPT_VERSION : null;

  await getDb().safetyCheck.upsert({
    where: { chain_tokenAddress: { chain, tokenAddress } },
    update: {
      passed: scored.passed,
      score: scored.score,
      checks: scored.checks,
      reasons: scored.reasons,
      ruleVersion: GUARD_RULE_VERSION,
      aiPromptVersion,
    },
    create: {
      chain,
      tokenAddress,
      passed: scored.passed,
      score: scored.score,
      checks: scored.checks,
      reasons: scored.reasons,
      ruleVersion: GUARD_RULE_VERSION,
      aiPromptVersion,
    },
  });

  eventBus.emit("guard.result", result);
  if (!result.passed) {
    eventBus.emit("guard.rejected", { chain, tokenAddress, reasons: result.reasons });
  }

  return result;
}

/** Returns a cached Guard result if it's fresh enough, otherwise re-screens the token. */
export async function getOrScreenToken(
  chain: Chain,
  tokenAddress: string,
  maxAgeMs = 10 * 60 * 1000,
): Promise<SafetyCheckResult> {
  const cached = await getDb().safetyCheck.findUnique({
    where: { chain_tokenAddress: { chain, tokenAddress } },
  });
  if (cached && Date.now() - cached.checkedAt.getTime() < maxAgeMs) {
    return {
      chain,
      tokenAddress,
      passed: cached.passed,
      score: cached.score,
      checks: cached.checks as Record<string, boolean>,
      reasons: cached.reasons as string[],
      checkedAt: cached.checkedAt.getTime(),
    };
  }
  return screenToken(chain, tokenAddress);
}
