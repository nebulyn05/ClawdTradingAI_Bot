import { z } from "zod";
import type { Chain, NetworkMode } from "./types.js";

const networkSchema = z.enum(["testnet", "mainnet"]).default("testnet");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),

  MASTER_ENCRYPTION_KEY: z
    .string()
    .optional()
    .default("")
    .refine((v) => v === "" || /^[0-9a-fA-F]{64}$/.test(v), {
      message: "MASTER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)",
    }),

  SOLANA_NETWORK: networkSchema,
  ETHEREUM_NETWORK: networkSchema,
  BSC_NETWORK: networkSchema,
  BASE_NETWORK: networkSchema,
  MONAD_NETWORK: networkSchema,
  ROBINHOOD_NETWORK: networkSchema,

  HELIUS_API_KEY: z.string().optional().default(""),
  SOLANA_DEVNET_RPC_URL: z.string().default("https://api.devnet.solana.com"),
  SOLANA_MAINNET_RPC_URL: z.string().optional().default(""),
  JUPITER_API_BASE: z.string().default("https://quote-api.jup.ag/v6"),

  ALCHEMY_API_KEY: z.string().optional().default(""),
  QUICKNODE_ETHEREUM_URL: z.string().optional().default(""),
  QUICKNODE_BSC_URL: z.string().optional().default(""),
  QUICKNODE_BASE_URL: z.string().optional().default(""),

  ETHEREUM_TESTNET_RPC_URL: z.string().default("https://ethereum-sepolia-rpc.publicnode.com"),
  ETHEREUM_MAINNET_RPC_URL: z.string().optional().default(""),
  BSC_TESTNET_RPC_URL: z.string().default("https://bsc-testnet-rpc.publicnode.com"),
  BSC_MAINNET_RPC_URL: z.string().optional().default(""),
  BASE_TESTNET_RPC_URL: z.string().default("https://base-sepolia-rpc.publicnode.com"),
  BASE_MAINNET_RPC_URL: z.string().optional().default(""),

  // Optional overrides for the Uniswap-V2-style factory/router/wrapped-native
  // Sniper and Router use. Mainnet has working defaults (see evm/config.ts);
  // testnets have none built in since there's no single canonical V2-fork
  // deployment on most public testnets — set these once you've picked one.
  ETHEREUM_FACTORY_ADDRESS: z.string().optional().default(""),
  ETHEREUM_ROUTER_ADDRESS: z.string().optional().default(""),
  ETHEREUM_WRAPPED_NATIVE_ADDRESS: z.string().optional().default(""),
  BSC_FACTORY_ADDRESS: z.string().optional().default(""),
  BSC_ROUTER_ADDRESS: z.string().optional().default(""),
  BSC_WRAPPED_NATIVE_ADDRESS: z.string().optional().default(""),
  BASE_FACTORY_ADDRESS: z.string().optional().default(""),
  BASE_ROUTER_ADDRESS: z.string().optional().default(""),
  BASE_WRAPPED_NATIVE_ADDRESS: z.string().optional().default(""),

  ONEINCH_API_KEY: z.string().optional().default(""),

  BIRDEYE_API_KEY: z.string().optional().default(""),
  DEXSCREENER_API_BASE: z.string().default("https://api.dexscreener.com"),

  LIFI_API_KEY: z.string().optional().default(""),

  PROFIT_FEE_RATE: z.coerce.number().min(0).max(1).default(0.02),
  FEE_TREASURY_SOLANA_ADDRESS: z.string().optional().default(""),
  FEE_TREASURY_EVM_ADDRESS: z.string().optional().default(""),

  TAKE_PROFIT_PCT: z.coerce.number().min(0).default(0.5),
  STOP_LOSS_PCT: z.coerce.number().min(0).max(1).default(0.2),
  MAX_CONCURRENT_POSITIONS_PER_CHAIN: z.coerce.number().int().min(1).default(3),
  POSITION_MONITOR_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),

  ARBITER_SCAN_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  // Placeholder until a verified LI.FI (or similar) bridge-quote integration
  // replaces it — see packages/specialists/arbiter/src/scan.ts.
  ARBITER_ASSUMED_BRIDGE_COST_PCT: z.coerce.number().min(0).max(1).default(0.005),
  ARBITER_MIN_SPREAD_PCT: z.coerce.number().min(0).max(1).default(0.01),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parses and validates process.env once per process. Throws with a readable
 * message listing every missing/invalid var instead of failing deep inside
 * whichever module first touched it.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clears the cached config so a test can reload with different env. */
export function _resetConfigCache(): void {
  cached = undefined;
}

const CHAIN_NETWORK_KEYS = {
  solana: "SOLANA_NETWORK",
  ethereum: "ETHEREUM_NETWORK",
  bsc: "BSC_NETWORK",
  base: "BASE_NETWORK",
  monad: "MONAD_NETWORK",
  robinhood: "ROBINHOOD_NETWORK",
} as const satisfies Record<Chain, keyof Env>;

/** Returns the configured network ("testnet" | "mainnet") for a given chain. */
export function networkForChain(chain: Chain): NetworkMode {
  const cfg = loadConfig();
  return cfg[CHAIN_NETWORK_KEYS[chain]] as NetworkMode;
}
