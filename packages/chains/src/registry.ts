import type { Chain } from "@clawd/core";
import type { ChainAdapter } from "./types.js";
import { createSolanaAdapter } from "./solana/adapter.js";
import { createEvmAdapter } from "./evm/adapter.js";

let registry: Partial<Record<Chain, ChainAdapter>> | undefined;

function buildRegistry(): Record<Chain, ChainAdapter> {
  return {
    solana: createSolanaAdapter(),
    ethereum: createEvmAdapter("ethereum"),
    bsc: createEvmAdapter("bsc"),
    base: createEvmAdapter("base"),
    monad: createEvmAdapter("monad"),
    robinhood: createEvmAdapter("robinhood"),
  };
}

/** Returns the (lazily-constructed, cached) adapter for `chain`. */
export function getChainAdapter(chain: Chain): ChainAdapter {
  registry ??= buildRegistry();
  const adapter = registry[chain];
  if (!adapter) throw new Error(`No adapter registered for chain "${chain}"`);
  return adapter;
}

/** Test-only: clears the cached registry so tests can rebuild it with different env/config. */
export function _resetRegistry(): void {
  registry = undefined;
}
