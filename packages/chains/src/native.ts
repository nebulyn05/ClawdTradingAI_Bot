import type { Chain } from "@clawd/core";
import { NATIVE_TOKEN_ADDRESS } from "./evm/abis.js";
import { isEvmChain } from "./evm/config.js";

/** Wrapped SOL mint — Jupiter quotes/swaps against this for "native SOL". */
export const SOLANA_NATIVE_MINT = "So11111111111111111111111111111111111111112";

/** The address Router should use to mean "this chain's native token" when building a quote. */
export function nativeQuoteAddress(chain: Chain): string {
  if (chain === "solana") return SOLANA_NATIVE_MINT;
  if (isEvmChain(chain)) return NATIVE_TOKEN_ADDRESS;
  throw new Error(`No native quote address defined for chain "${chain}"`);
}

export const NATIVE_DECIMALS: Record<Chain, number> = {
  solana: 9,
  ethereum: 18,
  bsc: 18,
  base: 18,
  monad: 18,
  robinhood: 18,
};

/** Formats a raw native-unit bigint (lamports/wei) as a human-readable decimal string. */
export function formatNativeAmount(chain: Chain, raw: bigint): string {
  const decimals = NATIVE_DECIMALS[chain];
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = (raw % divisor).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Parses a human-typed decimal amount (e.g. "0.5") into raw native units (lamports/wei). */
export function parseNativeAmount(chain: Chain, input: string): bigint {
  const decimals = NATIVE_DECIMALS[chain];
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${input}" isn't a valid amount.`);
  }
  const [wholeStr = "0", fracStr = ""] = trimmed.split(".");
  const paddedFrac = (fracStr + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(wholeStr) * 10n ** BigInt(decimals) + BigInt(paddedFrac || "0");
}
