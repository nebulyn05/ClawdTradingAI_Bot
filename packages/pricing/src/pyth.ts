import { createLogger } from "@clawd/core";

const log = createLogger("pricing:pyth");

/**
 * Pyth price feed IDs for major assets. These are widely-reused constants,
 * but verify against https://pyth.network/developers/price-feed-ids before
 * trusting them with real size — feed IDs are per-asset, not per-chain, and
 * this session couldn't fetch Pyth's docs live to double-check them (network
 * access is blocked in this environment).
 */
export const PYTH_PRICE_IDS: Record<string, string> = {
  "SOL/USD": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56",
  "ETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "BNB/USD": "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  "USDC/USD": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94",
};

interface HermesResponse {
  parsed?: Array<{ id: string; price: { price: string; expo: number; publish_time: number } }>;
}

/** Live price for a major asset via Pyth's Hermes API (keyless, public). Null if unavailable. */
export async function getPythPrice(symbol: keyof typeof PYTH_PRICE_IDS): Promise<number | null> {
  const priceId = PYTH_PRICE_IDS[symbol];
  if (!priceId) return null;

  try {
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${priceId}`;
    // Without an explicit timeout, an unreachable/slow host hangs on the OS-level
    // TCP timeout (can be 60s+) — long enough that a Telegram callback query
    // answering it expires before the call ever resolves. Fail fast instead.
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as HermesResponse;
    const entry = data.parsed?.[0];
    if (!entry) return null;
    return Number(entry.price.price) * 10 ** entry.price.expo;
  } catch (err) {
    log.warn({ err, symbol }, "Pyth price lookup failed");
    return null;
  }
}
