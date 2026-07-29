import { loadConfig, type Chain } from "@clawd/core";

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  pairCreatedAt?: number;
  volume?: { h24?: number };
}

// DexScreener's own chain identifiers, distinct from our internal Chain names.
const CHAIN_ID_MAP: Record<Chain, string> = {
  solana: "solana",
  ethereum: "ethereum",
  bsc: "bsc",
  base: "base",
  monad: "monad",
  robinhood: "robinhood",
};

/** Fetches all known trading pairs for `tokenAddress`, filtered to `chain`. Keyless public API. */
export async function getDexScreenerPairs(
  chain: Chain,
  tokenAddress: string,
): Promise<DexScreenerPair[]> {
  const { DEXSCREENER_API_BASE } = loadConfig();
  const res = await fetch(`${DEXSCREENER_API_BASE}/latest/dex/tokens/${tokenAddress}`);
  if (!res.ok) {
    throw new Error(`DexScreener request failed (${res.status})`);
  }
  const data = (await res.json()) as { pairs: DexScreenerPair[] | null };
  const chainId = CHAIN_ID_MAP[chain];
  return (data.pairs ?? []).filter((p) => p.chainId === chainId);
}

/** Returns the deepest-liquidity pair for a token, or null if none are indexed yet. */
export async function getBestPair(chain: Chain, tokenAddress: string): Promise<DexScreenerPair | null> {
  const pairs = await getDexScreenerPairs(chain, tokenAddress);
  if (pairs.length === 0) return null;
  return pairs.reduce((best, p) => ((p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best));
}
