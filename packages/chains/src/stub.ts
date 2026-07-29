import { networkForChain, type Chain } from "@clawd/core";
import type { ChainAdapter, Unsubscribe } from "./types.js";

/**
 * Placeholder adapter for chains without a verified public RPC/SDK yet
 * (Monad, Robinhood Chain). Registered so the rest of the system can look
 * them up uniformly, but every method throws — nothing silently no-ops.
 * TODO: replace once real RPC endpoint / chain ID / SDK docs are available.
 */
export function createStubAdapter(chain: Chain): ChainAdapter {
  const unsupported = (): never => {
    throw new Error(
      `Chain "${chain}" is not integrated yet (no verified public RPC/SDK). ` +
        "See packages/chains/src/stub.ts.",
    );
  };

  return {
    chain,
    network: networkForChain(chain),
    enabled: false,
    getBalance: async () => unsupported(),
    watchNewPairs: (): Unsubscribe => unsupported(),
    watchWallet: (): Unsubscribe => unsupported(),
    getQuote: async () => unsupported(),
    executeSwap: async () => unsupported(),
    withdraw: async () => unsupported(),
  };
}
