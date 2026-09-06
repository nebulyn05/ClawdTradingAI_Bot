import type { GuardCandidateConfig } from "./types.js";

/**
 * Pure candidate-Guard-rule-set filter: would this historical signal have
 * passed a Guard configured with `config` instead of the live rules? A
 * missing `guardScore` (no SafetyCheck row was ever cached for that token)
 * can't be evaluated, so it's excluded rather than assumed passing — fails
 * closed, same as Guard's own live behavior when a review can't be completed.
 */
export function guardWouldPass(
  guardScore: number | null,
  guardChecks: Record<string, boolean> | null,
  config: GuardCandidateConfig,
): boolean {
  if (guardScore === null) return false;
  if (guardScore < config.passThreshold) return false;

  if (config.requireChecks) {
    for (const check of config.requireChecks) {
      if (guardChecks?.[check] !== true) return false;
    }
  }

  return true;
}
