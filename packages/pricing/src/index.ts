import type { Chain } from "@clawd/core";
import { getBirdeyePrice } from "./birdeye.js";
import { getBestPair } from "./dexscreener.js";

export * from "./birdeye.js";
export * from "./dexscreener.js";

/**
 * Best-effort unified USD price lookup: tries Birdeye for Solana (when
 * configured), then falls back to DexScreener's best-liquidity pair for any
 * chain. Returns null if no price is available from either source.
 */
export async function getTokenPriceUsd(chain: Chain, tokenAddress: string): Promise<number | null> {
  if (chain === "solana") {
    const birdeyePrice = await getBirdeyePrice(tokenAddress).catch(() => null);
    if (birdeyePrice !== null) return birdeyePrice;
  }
  const pair = await getBestPair(chain, tokenAddress).catch(() => null);
  const price = pair?.priceUsd ? Number(pair.priceUsd) : null;
  return price !== null && !Number.isNaN(price) ? price : null;
}
