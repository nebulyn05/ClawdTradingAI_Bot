import type { Chain } from "@clawd/core";
import { getPythPrice } from "./pyth.js";
import { getChainlinkPrice } from "./chainlink.js";

export type NativeAssetSymbol = "SOL/USD" | "ETH/USD" | "BNB/USD";

/**
 * Maps a chain to its native gas token's Pyth price symbol. Monad and
 * Robinhood Chain return null rather than a guessed feed — Monad's MON has
 * no listed Pyth feed, and Robinhood Chain's actual native gas token hasn't
 * been verified. Callers should treat null as "price unavailable," not $0.
 */
export function nativeAssetPythSymbol(chain: Chain): NativeAssetSymbol | null {
  switch (chain) {
    case "solana":
      return "SOL/USD";
    case "ethereum":
    case "base":
      return "ETH/USD";
    case "bsc":
      return "BNB/USD";
    case "monad":
    case "robinhood":
      return null;
  }
}

/**
 * Live USD price for `chain`'s native gas token, or null if unavailable/unpriced.
 * Tries Pyth's Hermes API first; for the EVM chains with a known Chainlink
 * feed (ethereum/base ETH, bsc BNB), falls back to reading the feed directly
 * on-chain if Pyth is unavailable — a second, independent source that needs
 * no extra API key since it reuses the chain's own RPC connection. Solana has
 * no equivalent fallback (Chainlink's on-chain feeds are EVM-only here), so
 * it still depends on Pyth alone.
 */
export async function getNativeAssetUsdPrice(chain: Chain): Promise<number | null> {
  const symbol = nativeAssetPythSymbol(chain);
  if (!symbol) return null;

  const pythPrice = await getPythPrice(symbol);
  if (pythPrice !== null) return pythPrice;

  switch (chain) {
    case "ethereum":
    case "base":
      return getChainlinkPrice(chain, "ETH/USD");
    case "bsc":
      return getChainlinkPrice(chain, "BNB/USD");
    default:
      return null;
  }
}
