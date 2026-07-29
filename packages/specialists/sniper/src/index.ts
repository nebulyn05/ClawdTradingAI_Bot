import { eventBus, createLogger, type Chain } from "@clawd/core";
import { getChainAdapter, type Unsubscribe } from "@clawd/chains";

const log = createLogger("sniper");

const DEFAULT_CHAINS: Chain[] = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"];

/**
 * Subscribes to new-launch/new-pair events on every enabled chain and
 * republishes them as `sniper.newPair` on the shared event bus for Guard/
 * Router to pick up. Chains without a configured factory/adapter (e.g. Base
 * without a V2 factory address set) are skipped with a warning rather than
 * crashing the whole pipeline.
 */
export function startSniper(chains: Chain[] = DEFAULT_CHAINS): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  for (const chain of chains) {
    const adapter = getChainAdapter(chain);
    if (!adapter.enabled) continue;

    try {
      const unsubscribe = adapter.watchNewPairs((pair) => {
        log.info({ chain, tokenAddress: pair.tokenAddress, dex: pair.dex }, "New pair detected");
        eventBus.emit("sniper.newPair", pair);
      });
      unsubs.push(unsubscribe);
      log.info({ chain }, "Sniper watching for new pairs");
    } catch (err) {
      log.warn({ err, chain }, "Could not start Sniper for chain — adapter not fully configured?");
    }
  }

  return () => unsubs.forEach((unsub) => unsub());
}
