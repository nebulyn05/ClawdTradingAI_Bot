import type { Chain } from "@clawd/core";

/** Shared display constants for chain-related UI — menu.ts and the transfer conversations both need these. */

export const NATIVE_SYMBOL: Record<Chain, string> = {
  solana: "SOL",
  ethereum: "ETH",
  bsc: "BNB",
  base: "ETH",
  monad: "MON",
  robinhood: "ETH",
};

export const CHAIN_ICON: Record<Chain, string> = {
  base: "🟦",
  ethereum: "💠",
  bsc: "🔶",
  monad: "🟣",
  robinhood: "🍃",
  solana: "▪️",
};

export const CHAIN_LABEL: Record<Chain, string> = {
  base: "Base",
  ethereum: "Ethereum",
  bsc: "Binance",
  monad: "Monad",
  robinhood: "Robinhood",
  solana: "Solana",
};
