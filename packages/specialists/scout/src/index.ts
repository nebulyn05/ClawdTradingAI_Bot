import { getDb } from "@clawd/db";
import { eventBus, createLogger, type Chain } from "@clawd/core";
import { getChainAdapter, type Unsubscribe } from "@clawd/chains";

const log = createLogger("scout");

const DEFAULT_CHAINS: Chain[] = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"];

/** Adds an address to the smart-money watchlist Scout draws from. */
export async function addWatchlistEntry(chain: Chain, address: string, label?: string) {
  return getDb().watchlist.upsert({
    where: { chain_address: { chain, address } },
    update: { active: true, label },
    create: { chain, address, label },
  });
}

/**
 * Subscribes to every active watchlist entry's on-chain activity and
 * republishes buy-side activity as `scout.walletActivity` — a sell from a
 * watched wallet isn't itself a signal to buy, so those are dropped here.
 */
export async function startScout(chains: Chain[] = DEFAULT_CHAINS): Promise<Unsubscribe> {
  const entries = await getDb().watchlist.findMany({ where: { active: true, chain: { in: chains } } });

  const unsubs: Unsubscribe[] = [];
  for (const entry of entries) {
    const adapter = getChainAdapter(entry.chain);
    if (!adapter.enabled) continue;

    try {
      const unsubscribe = adapter.watchWallet(entry.address, (activity) => {
        if (activity.side !== "buy") return;
        log.info(
          { chain: entry.chain, watched: entry.address, token: activity.tokenAddress },
          "Smart-money buy detected",
        );
        eventBus.emit("scout.walletActivity", activity);
      });
      unsubs.push(unsubscribe);
    } catch (err) {
      log.warn({ err, chain: entry.chain, address: entry.address }, "Failed to watch address");
    }
  }

  log.info({ count: unsubs.length, total: entries.length }, "Scout watching wallets");
  return () => unsubs.forEach((unsub) => unsub());
}
