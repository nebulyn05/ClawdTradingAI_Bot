import { eventBus, loadConfig, createLogger, type Chain, type ArbitrageOpportunity } from "@clawd/core";
import { getChainAdapter } from "@clawd/chains";
import { getTokenPriceUsd } from "@clawd/pricing";
import { ARB_ASSETS } from "./assets.js";
import { findSpreadCandidates } from "./spread.js";
import { getLifiBridgeCostPct } from "./lifi-quote.js";

const log = createLogger("arbiter");

/**
 * Scans the tracked asset list for cross-chain price spreads.
 *
 * Two-pass filter: a cheap first pass uses ARBITER_ASSUMED_BRIDGE_COST_PCT
 * (a fixed guess) purely to avoid spending a LI.FI request on hopeless
 * pairs; every candidate that clears it then gets a *real* LI.FI quote
 * (lifi-quote.ts) for the actual bridge cost at the configured notional
 * size, and only survives if the spread still clears that real cost. If
 * LI.FI doesn't cover a chain (Monad/Robinhood aren't in its chain list) or
 * a request fails, that pair falls back to the fixed assumption rather than
 * being dropped outright.
 *
 * Still detection-only for chains LI.FI can't execute against — see
 * execute.ts for what cross-chain execution actually supports today
 * (EVM<->EVM; Solana legs aren't wired for execution, only quoting).
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

    const preFiltered = findSpreadCandidates(
      prices,
      cfg.ARBITER_ASSUMED_BRIDGE_COST_PCT,
      cfg.ARBITER_MIN_SPREAD_PCT,
    );

    const quoteAmountRaw = BigInt(Math.round(cfg.ARBITER_QUOTE_SIZE * 10 ** asset.decimals));

    for (const c of preFiltered) {
      const buyAddress = asset.addresses[c.buyChain];
      const realCostPct = buyAddress
        ? await getLifiBridgeCostPct(c.buyChain, c.sellChain, buyAddress, quoteAmountRaw)
        : null;
      const bridgeCostPct = realCostPct ?? cfg.ARBITER_ASSUMED_BRIDGE_COST_PCT;

      if (c.spreadPct <= bridgeCostPct + cfg.ARBITER_MIN_SPREAD_PCT) continue;

      const opportunity: ArbitrageOpportunity = {
        asset: asset.symbol,
        buyChain: c.buyChain,
        sellChain: c.sellChain,
        buyPrice: c.buyPrice,
        sellPrice: c.sellPrice,
        spreadPct: c.spreadPct,
        estimatedBridgeCostPct: bridgeCostPct,
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
