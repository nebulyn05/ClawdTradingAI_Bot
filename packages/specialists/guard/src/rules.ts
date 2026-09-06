import type { EvmTokenSecurity, SolanaTokenSecurity } from "./goplus.js";

export const MIN_LIQUIDITY_USD = 1000;
export const PASS_THRESHOLD = 60;

/**
 * Bump this whenever the mechanical scoring logic below changes (a new
 * check, a different threshold/weight) — SafetyCheck rows persist whichever
 * version produced them, so drift-detection (drift.ts) can tell which
 * rule-version's accuracy it's actually looking at.
 */
export const GUARD_RULE_VERSION = "v1";

export interface ScoreResult {
  checks: Record<string, boolean>;
  reasons: string[];
  score: number;
  passed: boolean;
}

/**
 * Pure scoring function: given already-fetched liquidity + security data,
 * computes the checks/reasons/score/passed verdict. Kept separate from
 * score.ts's I/O (network + DB) so the actual rules are unit-testable
 * without mocking fetch or Prisma.
 */
export function computeSolanaScore(liquidityUsd: number, sec: SolanaTokenSecurity | null): ScoreResult {
  const checks: Record<string, boolean> = {};
  const reasons: string[] = [];
  let score = 100;

  checks.sufficientLiquidity = liquidityUsd >= MIN_LIQUIDITY_USD;
  if (!checks.sufficientLiquidity) {
    score -= 40;
    reasons.push(`Liquidity $${liquidityUsd.toFixed(0)} is below the $${MIN_LIQUIDITY_USD} minimum`);
  }

  if (sec) {
    checks.mintAuthorityRenounced = sec.mintable?.status !== "1";
    checks.freezeAuthorityRenounced = sec.freezable?.status !== "1";
    if (!checks.mintAuthorityRenounced) {
      score -= 30;
      reasons.push("Mint authority is not renounced — supply can be inflated at will");
    }
    if (!checks.freezeAuthorityRenounced) {
      score -= 20;
      reasons.push("Freeze authority is not renounced — accounts can be frozen at will");
    }
    const top10 = Number(sec.top10_holder_rate ?? 0);
    checks.holderConcentrationOk = top10 < 0.5;
    if (!checks.holderConcentrationOk) {
      score -= 20;
      reasons.push(`Top 10 holders own ${(top10 * 100).toFixed(0)}% of supply`);
    }
  } else {
    reasons.push("Solana token-security data unavailable (likely testnet) — those checks were skipped");
  }

  return finalize(checks, reasons, score);
}

export function computeEvmScore(liquidityUsd: number, sec: EvmTokenSecurity | null): ScoreResult {
  const checks: Record<string, boolean> = {};
  const reasons: string[] = [];
  let score = 100;

  checks.sufficientLiquidity = liquidityUsd >= MIN_LIQUIDITY_USD;
  if (!checks.sufficientLiquidity) {
    score -= 40;
    reasons.push(`Liquidity $${liquidityUsd.toFixed(0)} is below the $${MIN_LIQUIDITY_USD} minimum`);
  }

  if (sec) {
    checks.notHoneypot = sec.is_honeypot !== "1";
    if (!checks.notHoneypot) {
      score -= 100;
      reasons.push("Flagged as a honeypot — sells may be blocked");
    }
    const ownerAddr = sec.owner_address?.toLowerCase();
    checks.ownershipRenounced = !ownerAddr || ownerAddr === "0x0000000000000000000000000000000000000000";
    if (!checks.ownershipRenounced) {
      score -= 15;
      reasons.push("Contract ownership is not renounced");
    }
    const sellTax = Number(sec.sell_tax ?? 0);
    checks.reasonableSellTax = sellTax <= 0.15;
    if (!checks.reasonableSellTax) {
      score -= 25;
      reasons.push(`Sell tax of ${(sellTax * 100).toFixed(0)}% is unusually high`);
    }
  } else {
    reasons.push("EVM token-security data unavailable (likely testnet) — those checks were skipped");
  }

  return finalize(checks, reasons, score);
}

function finalize(checks: Record<string, boolean>, reasons: string[], rawScore: number): ScoreResult {
  const score = Math.max(0, Math.min(100, rawScore));
  const passed = score >= PASS_THRESHOLD && checks.notHoneypot !== false;
  return { checks, reasons, score, passed };
}
