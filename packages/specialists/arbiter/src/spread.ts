import type { Chain } from "@clawd/core";

export interface SpreadCandidate {
  buyChain: Chain;
  sellChain: Chain;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
}

/**
 * Pure function: given a chain->USD-price map for one asset, finds every
 * directed pair (buyChain, sellChain) whose spread clears the assumed
 * bridging cost plus a minimum margin. Kept separate from scan.ts's network
 * I/O so the actual arbitrage math is unit-testable.
 */
export function findSpreadCandidates(
  prices: Partial<Record<Chain, number>>,
  bridgeCostPct: number,
  minSpreadPct: number,
): SpreadCandidate[] {
  const entries = Object.entries(prices) as [Chain, number][];
  const candidates: SpreadCandidate[] = [];

  for (const [buyChain, buyPrice] of entries) {
    for (const [sellChain, sellPrice] of entries) {
      if (buyChain === sellChain || buyPrice <= 0) continue;
      const spreadPct = (sellPrice - buyPrice) / buyPrice;
      if (spreadPct > bridgeCostPct + minSpreadPct) {
        candidates.push({ buyChain, sellChain, buyPrice, sellPrice, spreadPct });
      }
    }
  }

  return candidates;
}
