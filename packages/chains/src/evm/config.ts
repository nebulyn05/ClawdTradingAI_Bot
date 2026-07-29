import { mainnet, sepolia, bsc, bscTestnet, base, baseSepolia, type Chain as ViemChain } from "viem/chains";
import { loadConfig, networkForChain, type Chain } from "@clawd/core";

export type EvmChain = "ethereum" | "bsc" | "base";

interface EvmChainConfig {
  viemChain: ViemChain;
  rpcUrl: string;
  /** Uniswap-V2-style factory (emits PairCreated) used by Sniper to detect new pools. */
  factoryAddress: `0x${string}` | undefined;
  /** Uniswap-V2-style router used to price and execute swaps. */
  routerAddress: `0x${string}` | undefined;
  wrappedNativeAddress: `0x${string}` | undefined;
}

// Canonical mainnet deployments. Testnet factory/router addresses are usually
// project-specific (most public testnets don't have an "official" V2 fork),
// so those are left for the operator to fill in via env vars once they've
// picked a testnet DEX to integrate against.
const UNISWAP_V2_MAINNET = {
  factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f" as const,
  router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as const,
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const,
};

const PANCAKESWAP_V2_MAINNET = {
  factory: "0xcA143Ce532fe4E1feC97F8A2B678958c0E3AC4d" as const,
  router: "0x10ED43C718714eb63d5aA57B78B54704E256024E" as const,
  wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const,
};

function evmConfig(chain: EvmChain): EvmChainConfig {
  const cfg = loadConfig();
  const network = networkForChain(chain);

  switch (chain) {
    case "ethereum":
      return {
        viemChain: network === "mainnet" ? mainnet : sepolia,
        rpcUrl:
          network === "mainnet"
            ? cfg.ETHEREUM_MAINNET_RPC_URL ||
              (cfg.ALCHEMY_API_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${cfg.ALCHEMY_API_KEY}` : "")
            : cfg.ETHEREUM_TESTNET_RPC_URL,
        factoryAddress: network === "mainnet" ? UNISWAP_V2_MAINNET.factory : undefined,
        routerAddress: network === "mainnet" ? UNISWAP_V2_MAINNET.router : undefined,
        wrappedNativeAddress: network === "mainnet" ? UNISWAP_V2_MAINNET.weth : undefined,
      };
    case "bsc":
      return {
        viemChain: network === "mainnet" ? bsc : bscTestnet,
        rpcUrl: network === "mainnet" ? cfg.QUICKNODE_BSC_URL : cfg.BSC_TESTNET_RPC_URL,
        factoryAddress: network === "mainnet" ? PANCAKESWAP_V2_MAINNET.factory : undefined,
        routerAddress: network === "mainnet" ? PANCAKESWAP_V2_MAINNET.router : undefined,
        wrappedNativeAddress: network === "mainnet" ? PANCAKESWAP_V2_MAINNET.wbnb : undefined,
      };
    case "base":
      return {
        viemChain: network === "mainnet" ? base : baseSepolia,
        rpcUrl: network === "mainnet" ? cfg.QUICKNODE_BASE_URL : cfg.BASE_TESTNET_RPC_URL,
        // No canonical Uniswap-V2-style factory shipped here for Base — set via
        // a future env var once you've picked a V2-fork DEX (e.g. BaseSwap) to target.
        factoryAddress: undefined,
        routerAddress: undefined,
        wrappedNativeAddress: undefined,
      };
  }
}

export function isEvmChain(chain: Chain): chain is EvmChain {
  return chain === "ethereum" || chain === "bsc" || chain === "base";
}

export { evmConfig };
export type { EvmChainConfig };
