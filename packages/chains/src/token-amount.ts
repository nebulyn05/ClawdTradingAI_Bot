/**
 * Same string-based decimal <-> raw-bigint conversion as native.ts's
 * formatNativeAmount/parseNativeAmount, parameterized by an arbitrary
 * token's decimals instead of a fixed per-chain constant — used for
 * ERC20/SPL token transfers, where the decimals come from the token
 * contract/mint rather than NATIVE_DECIMALS. Never use floating-point
 * arithmetic on these amounts (see tp-sl.ts's computeFeeRaw for why).
 */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = (raw % divisor).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function parseTokenAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${input}" isn't a valid amount.`);
  }
  const [wholeStr = "0", fracStr = ""] = trimmed.split(".");
  const paddedFrac = (fracStr + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(wholeStr) * 10n ** BigInt(decimals) + BigInt(paddedFrac || "0");
}
