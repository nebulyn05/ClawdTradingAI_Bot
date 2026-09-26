import {
  mainnet,
  sepolia,
  bsc,
  bscTestnet,
  base,
  baseSepolia,
  monad,
  monadTestnet,
  robinhood,
  robinhoodTestnet,
  type Chain as ViemChain,
} from "viem/chains";
import { loadConfig, networkForChain, type Chain } from "@clawd/core";
import { parseRpcUrlList } from "../rpc-failover.js";

export type EvmChain = "ethereum" | "bsc" | "base" | "monad" | "robinhood";

interface EvmChainConfig {
  viemChain: ViemChain;
  rpcUrl: string;
  /** Secondary RPC endpoints tried in order if the primary fails (see evm/transport.ts). Empty when no failover is configured. */
  fallbackRpcUrls: string[];
  /** Websocket RPC for live subscriptions (PairCreated/Transfer logs, blocks). */
  wsUrl: string;
  /** Uniswap-V2-style factory (emits PairCreated) used by Sniper to detect new pools. */
  factoryAddress: `0x${string}` | undefined;
  /** Uniswap-V2-style router used to price and execute swaps. */
  routerAddress: `0x${string}` | undefined;
  wrappedNativeAddress: `0x${string}` | undefined;
  /** Uniswap V3 factory used for pool discovery/validation. */
  v3FactoryAddress?: `0x${string}`;
  /** Uniswap V3 QuoterV2 used for live quotes. */
  v3QuoterAddress?: `0x${string}`;
  /** Uniswap V3 SwapRouter02 used for live execution. */
  v3RouterAddress?: `0x${string}`;
}

// Canonical mainnet deployments. Testnets have no default — most public
// testnets don't have a single "official" V2 fork — so those fall back to
// the *_FACTORY_ADDRESS / *_ROUTER_ADDRESS / *_WRAPPED_NATIVE_ADDRESS env
// vars. Base, Monad and Robinhood Chain also have current Uniswap V2
// deployments, while this adapter prefers their newer V3 route for trading.
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

type Address = `0x${string}` | undefined;

const UNISWAP_V3_MAINNET: Partial<Record<EvmChain, { factory: string; quoter: string; router: string; wrappedNative: string }>> = {
  base: {
    factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    wrappedNative: "0x4200000000000000000000000000000000000006",
  },
  monad: {
    factory: "0x204faca1764b154221e35c0d20abb3c525710498",
    quoter: "0x661e93cca42afacb172121ef892830ca3b70f08d",
    router: "0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900",
    wrappedNative: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
  },
  robinhood: {
    factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
    quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
    router: "0xcaf681a66d020601342297493863e78c959e5cb2",
    wrappedNative: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  },
};

function resolved(envValue: string, mainnetDefault: string | undefined, network: string): Address {
  if (envValue) return envValue as Address;
  if (network === "mainnet" && mainnetDefault) return mainnetDefault as Address;
  return undefined;
}

function fallbackUrlsFor(mainnetCsv: string, testnetCsv: string, network: string): string[] {
  return parseRpcUrlList(network === "mainnet" ? mainnetCsv : testnetCsv);
}

/** Derives a wss:// URL from an http(s) one (works for Alchemy/QuickNode) unless overridden. */
function wsFor(override: string, httpUrl: string): string {
  if (override) return override;
  if (!httpUrl) return "";
  return httpUrl.replace(/^http/, "ws");
}

function evmConfig(chain: EvmChain): EvmChainConfig {
  const cfg = loadConfig();
  const network = networkForChain(chain);

  switch (chain) {
    case "ethereum": {
      const rpcUrl =
        network === "mainnet"
          ? cfg.ETHEREUM_MAINNET_RPC_URL ||
            (cfg.ALCHEMY_API_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${cfg.ALCHEMY_API_KEY}` : "")
          : cfg.ETHEREUM_TESTNET_RPC_URL;
      return {
        viemChain: network === "mainnet" ? mainnet : sepolia,
        rpcUrl,
        fallbackRpcUrls: fallbackUrlsFor(
          cfg.ETHEREUM_MAINNET_RPC_FALLBACK_URLS,
          cfg.ETHEREUM_TESTNET_RPC_FALLBACK_URLS,
          network,
        ),
        wsUrl: wsFor(
          network === "mainnet" ? cfg.ETHEREUM_MAINNET_WS_URL : cfg.ETHEREUM_TESTNET_WS_URL,
          rpcUrl,
        ),
        factoryAddress: resolved(cfg.ETHEREUM_FACTORY_ADDRESS, UNISWAP_V2_MAINNET.factory, network),
        routerAddress: resolved(cfg.ETHEREUM_ROUTER_ADDRESS, UNISWAP_V2_MAINNET.router, network),
        wrappedNativeAddress: resolved(
          cfg.ETHEREUM_WRAPPED_NATIVE_ADDRESS,
          UNISWAP_V2_MAINNET.weth,
          network,
        ),
      };
    }
    case "bsc": {
      const rpcUrl = network === "mainnet" ? cfg.BSC_MAINNET_RPC_URL : cfg.BSC_TESTNET_RPC_URL;
      return {
        viemChain: network === "mainnet" ? bsc : bscTestnet,
        rpcUrl,
        fallbackRpcUrls: fallbackUrlsFor(
          cfg.BSC_MAINNET_RPC_FALLBACK_URLS,
          cfg.BSC_TESTNET_RPC_FALLBACK_URLS,
          network,
        ),
        wsUrl: wsFor(network === "mainnet" ? cfg.BSC_MAINNET_WS_URL : cfg.BSC_TESTNET_WS_URL, rpcUrl),
        factoryAddress: resolved(cfg.BSC_FACTORY_ADDRESS, PANCAKESWAP_V2_MAINNET.factory, network),
        routerAddress: resolved(cfg.BSC_ROUTER_ADDRESS, PANCAKESWAP_V2_MAINNET.router, network),
        wrappedNativeAddress: resolved(
          cfg.BSC_WRAPPED_NATIVE_ADDRESS,
          PANCAKESWAP_V2_MAINNET.wbnb,
          network,
        ),
      };
    }
    case "base": {
      const rpcUrl = network === "mainnet" ? cfg.BASE_MAINNET_RPC_URL : cfg.BASE_TESTNET_RPC_URL;
      return {
        viemChain: network === "mainnet" ? base : baseSepolia,
        rpcUrl,
        fallbackRpcUrls: fallbackUrlsFor(
          cfg.BASE_MAINNET_RPC_FALLBACK_URLS,
          cfg.BASE_TESTNET_RPC_FALLBACK_URLS,
          network,
        ),
        wsUrl: wsFor(network === "mainnet" ? cfg.BASE_MAINNET_WS_URL : cfg.BASE_TESTNET_WS_URL, rpcUrl),
        factoryAddress: resolved(cfg.BASE_FACTORY_ADDRESS, undefined, network),
        routerAddress: resolved(cfg.BASE_ROUTER_ADDRESS, undefined, network),
        wrappedNativeAddress: resolved(cfg.BASE_WRAPPED_NATIVE_ADDRESS, undefined, network),
        v3FactoryAddress: resolved(cfg.BASE_V3_FACTORY_ADDRESS, UNISWAP_V3_MAINNET.base?.factory, network),
        v3QuoterAddress: resolved(cfg.BASE_V3_QUOTER_ADDRESS, UNISWAP_V3_MAINNET.base?.quoter, network),
        v3RouterAddress: resolved(cfg.BASE_V3_ROUTER_ADDRESS, UNISWAP_V3_MAINNET.base?.router, network),
      };
    }
    case "monad": {
      // viem's built-in `monad`/`monadTestnet` definitions already carry the
      // correct chain ID (143 / 10143) and RPC URLs — used directly rather
      // than re-declaring them.
      const viemChain = network === "mainnet" ? monad : monadTestnet;
      const rpcUrl =
        (network === "mainnet" ? cfg.MONAD_MAINNET_RPC_URL : cfg.MONAD_TESTNET_RPC_URL) ||
        viemChain.rpcUrls.default.http[0] ||
        "";
      return {
        viemChain,
        rpcUrl,
        fallbackRpcUrls: fallbackUrlsFor(
          cfg.MONAD_MAINNET_RPC_FALLBACK_URLS,
          cfg.MONAD_TESTNET_RPC_FALLBACK_URLS,
          network,
        ),
        wsUrl: wsFor(
          network === "mainnet" ? cfg.MONAD_MAINNET_WS_URL : cfg.MONAD_TESTNET_WS_URL,
          rpcUrl,
        ),
        factoryAddress: resolved(cfg.MONAD_FACTORY_ADDRESS, undefined, network),
        routerAddress: resolved(cfg.MONAD_ROUTER_ADDRESS, undefined, network),
        wrappedNativeAddress: resolved(cfg.MONAD_WRAPPED_NATIVE_ADDRESS, undefined, network),
        v3FactoryAddress: resolved(cfg.MONAD_V3_FACTORY_ADDRESS, UNISWAP_V3_MAINNET.monad?.factory, network),
        v3QuoterAddress: resolved(cfg.MONAD_V3_QUOTER_ADDRESS, UNISWAP_V3_MAINNET.monad?.quoter, network),
        v3RouterAddress: resolved(cfg.MONAD_V3_ROUTER_ADDRESS, UNISWAP_V3_MAINNET.monad?.router, network),
      };
    }
    case "robinhood": {
      const viemChain = network === "mainnet" ? robinhood : robinhoodTestnet;
      const rpcUrl =
        (network === "mainnet" ? cfg.ROBINHOOD_MAINNET_RPC_URL : cfg.ROBINHOOD_TESTNET_RPC_URL) ||
        viemChain.rpcUrls.default.http[0] ||
        "";
      return {
        viemChain,
        rpcUrl,
        fallbackRpcUrls: fallbackUrlsFor(
          cfg.ROBINHOOD_MAINNET_RPC_FALLBACK_URLS,
          cfg.ROBINHOOD_TESTNET_RPC_FALLBACK_URLS,
          network,
        ),
        wsUrl: wsFor(
          network === "mainnet" ? cfg.ROBINHOOD_MAINNET_WS_URL : cfg.ROBINHOOD_TESTNET_WS_URL,
          rpcUrl,
        ),
        // V2 remains available as a configured fallback/legacy integration.
        factoryAddress: resolved(cfg.ROBINHOOD_FACTORY_ADDRESS, undefined, network),
        routerAddress: resolved(cfg.ROBINHOOD_ROUTER_ADDRESS, undefined, network),
        wrappedNativeAddress: resolved(cfg.ROBINHOOD_WRAPPED_NATIVE_ADDRESS, UNISWAP_V3_MAINNET.robinhood?.wrappedNative, network),
        v3FactoryAddress: resolved(cfg.ROBINHOOD_V3_FACTORY_ADDRESS, UNISWAP_V3_MAINNET.robinhood?.factory, network),
        v3QuoterAddress: resolved(cfg.ROBINHOOD_V3_QUOTER_ADDRESS, UNISWAP_V3_MAINNET.robinhood?.quoter, network),
        v3RouterAddress: resolved(cfg.ROBINHOOD_V3_ROUTER_ADDRESS, UNISWAP_V3_MAINNET.robinhood?.router, network),
      };
    }
  }
}

export function isEvmChain(chain: Chain): chain is EvmChain {
  return (
    chain === "ethereum" ||
    chain === "bsc" ||
    chain === "base" ||
    chain === "monad" ||
    chain === "robinhood"
  );
}

export { evmConfig };
export type { EvmChainConfig };
