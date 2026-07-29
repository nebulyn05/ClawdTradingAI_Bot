import { eventBus, loadConfig, createLogger, type Chain, type ArbitrageOpportunity } from "@clawd/core";
import { getChainAdapter } from "@clawd/chains";
import { getTokenPriceUsd } from "@clawd/pricing";
import { ARB_ASSETS } from "./assets.js";
import { findSpreadCandidates } from "./spread.js";

const log = createLogger("arbiter");

/**
 * Scans the tracked asset list for cross-chain price spreads. The bridging
 * cost used to filter noise is currently a fixed assumption
 * (ARBITER_ASSUMED_BRIDGE_COST_PCT), not a live quote — LI.FI's docs weren't
 * reachable to confirm the exact request format for a real integration, so
 * this is intentionally conservative rather than guessing at an API shape.
 * Detection only: this does not execute trades. Cross-chain execution
 * (buy + bridge + sell) is a separate, not-yet-built follow-up.
 */
export async function scanForArbitrage(chains?: Chain[]): Promise<ArbitrageOpportunity[]> {
  const cfg = loadConfig();
  const opportunities: ArbitrageOpportunity[] = [];

  for (const asset of ARB_ASSETS) {
    const candidateChains = (Object.keys(asset.addresses) as Chain[]).filter(
      (c) => !chains || chains.includes(c),
    );
    const prices: Partial<Record<Chain, number>> = {};

    for (const chain of candidateChains) {
      const adapter = getChainAdapter(chain);
      if (!adapter.enabled) continue;
      const address = asset.addresses[chain];
      if (!address) continue;
      const price = await getTokenPriceUsd(chain, address).catch((err) => {
        log.warn({ err, chain, asset: asset.symbol }, "Price lookup failed");
        return null;
      });
      if (price !== null) prices[chain] = price;
    }

    const candidates = findSpreadCandidates(
      prices,
      cfg.ARBITER_ASSUMED_BRIDGE_COST_PCT,
      cfg.ARBITER_MIN_SPREAD_PCT,
    );

    for (const c of candidates) {
      const opportunity: ArbitrageOpportunity = {
        asset: asset.symbol,
        buyChain: c.buyChain,
        sellChain: c.sellChain,
        buyPrice: c.buyPrice,
        sellPrice: c.sellPrice,
        spreadPct: c.spreadPct,
        estimatedBridgeCostPct: cfg.ARBITER_ASSUMED_BRIDGE_COST_PCT,
        detectedAt: Date.now(),
      };
      log.info(opportunity, "Arbitrage opportunity detected");
      eventBus.emit("arbiter.opportunity", opportunity);
      opportunities.push(opportunity);
    }
  }

  return opportunities;
}

/** Starts a recurring Arbiter scan loop. Returns a function to stop it. */
export function startArbiter(intervalMs: number): () => void {
  const timer = setInterval(() => {
    scanForArbitrage().catch((err) => log.error({ err }, "Arbiter scan failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
