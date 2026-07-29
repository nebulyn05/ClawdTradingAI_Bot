import { loadConfig } from "@clawd/core";

interface BirdeyePriceResponse {
  success: boolean;
  data?: { value: number; updateUnixTime: number };
}

/** Solana token price in USD via Birdeye. Returns null if no API key is configured or the call fails. */
export async function getBirdeyePrice(tokenAddress: string): Promise<number | null> {
  const { BIRDEYE_API_KEY } = loadConfig();
  if (!BIRDEYE_API_KEY) return null;

  const res = await fetch(`https://public-api.birdeye.so/defi/price?address=${tokenAddress}`, {
    headers: { "X-API-KEY": BIRDEYE_API_KEY, "x-chain": "solana" },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as BirdeyePriceResponse;
  return data.success ? (data.data?.value ?? null) : null;
}
