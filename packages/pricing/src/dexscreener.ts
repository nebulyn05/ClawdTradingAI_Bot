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
const CHAIN_ID_TO_CHAIN = new Map(Object.entries(CHAIN_ID_MAP).map(([chain, id]) => [id, chain as Chain]));

async function fetchAllPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
  const { DEXSCREENER_API_BASE } = loadConfig();
  const res = await fetch(`${DEXSCREENER_API_BASE}/latest/dex/tokens/${tokenAddress}`);
  if (!res.ok) {
    throw new Error(`DexScreener request failed (${res.status})`);
  }
  const data = (await res.json()) as { pairs: DexScreenerPair[] | null };
  return data.pairs ?? [];
}

/** Fetches all known trading pairs for `tokenAddress`, filtered to `chain`. Keyless public API. */
export async function getDexScreenerPairs(chain: Chain, tokenAddress: string): Promise<DexScreenerPair[]> {
  const chainId = CHAIN_ID_MAP[chain];
  return (await fetchAllPairs(tokenAddress)).filter((p) => p.chainId === chainId);
}

/** Returns the deepest-liquidity pair for a token, or null if none are indexed yet. */
export async function getBestPair(chain: Chain, tokenAddress: string): Promise<DexScreenerPair | null> {
  const pairs = await getDexScreenerPairs(chain, tokenAddress);
  if (pairs.length === 0) return null;
  return pairs.reduce((best, p) => ((p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best));
}

/**
 * Detects which of our supported chains a bare token/contract address
 * belongs to, by checking DexScreener's index across every chain (not just
 * one) and picking the deepest-liquidity match. Used when a signal source
 * (e.g. a KOL tweet) gives an address with no chain context. Null if the
 * address isn't indexed anywhere yet, or is on a chain we don't support.
 */
export async function detectChainForToken(tokenAddress: string): Promise<Chain | null> {
  const pairs = await fetchAllPairs(tokenAddress);
  const supported = pairs.filter((p) => CHAIN_ID_TO_CHAIN.has(p.chainId));
  if (supported.length === 0) return null;
  const best = supported.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
  return CHAIN_ID_TO_CHAIN.get(best.chainId) ?? null;
}
