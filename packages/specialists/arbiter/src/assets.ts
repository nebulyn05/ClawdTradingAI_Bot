import type { Chain } from "@clawd/core";

export interface ArbAsset {
  symbol: string;
  /** Per-chain token address for the same logical asset. Verify against a canonical
   * source (e.g. Circle's registry for USDC) before trusting these with real capital. */
  addresses: Partial<Record<Chain, string>>;
  /** Smallest-unit decimals — same across chains for USDC, but kept explicit per asset. */
  decimals: number;
}

export const ARB_ASSETS: ArbAsset[] = [
  {
    symbol: "USDC",
    decimals: 6,
    addresses: {
      solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
  },
];
