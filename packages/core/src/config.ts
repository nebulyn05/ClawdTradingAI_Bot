import { z } from "zod";
import type { Chain, NetworkMode } from "./types.js";

const networkSchema = z.enum(["testnet", "mainnet"]).default("testnet");

// z.coerce.boolean() coerces ANY non-empty string (including the literal
// text "false") to `true` — not what an env var flag needs. This parses the
// actual text instead.
const boolFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .default(String(defaultValue))
    .transform((v) => v === "true" || v === "1");

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

  // Websocket RPC overrides for Sniper/Scout's live subscriptions (PairCreated,
  // Transfer logs, blocks). If unset, derived automatically from the http(s)
  // RPC URL by swapping the scheme to wss:// — works for Alchemy/QuickNode,
  // override here if your provider needs a different websocket endpoint.
  ETHEREUM_MAINNET_WS_URL: z.string().optional().default(""),
  ETHEREUM_TESTNET_WS_URL: z.string().optional().default(""),
  BSC_MAINNET_WS_URL: z.string().optional().default(""),
  BSC_TESTNET_WS_URL: z.string().optional().default(""),
  BASE_MAINNET_WS_URL: z.string().optional().default(""),
  BASE_TESTNET_WS_URL: z.string().optional().default(""),
  MONAD_MAINNET_WS_URL: z.string().optional().default(""),
  MONAD_TESTNET_WS_URL: z.string().optional().default(""),
  ROBINHOOD_MAINNET_WS_URL: z.string().optional().default(""),
  ROBINHOOD_TESTNET_WS_URL: z.string().optional().default(""),

  // Monad (chain 143 mainnet / 10143 testnet) and Robinhood Chain (4663
  // mainnet / 46630 testnet) — both EVM-compatible, handled by the same EVM
  // adapter family as Ethereum/BSC/Base.
  MONAD_MAINNET_RPC_URL: z.string().default("https://rpc.monad.xyz"),
  // No default — Monad's testnet RPC is known to get reset/migrated; set this
  // from https://docs.monad.xyz right before use.
  MONAD_TESTNET_RPC_URL: z.string().optional().default(""),
  ROBINHOOD_MAINNET_RPC_URL: z.string().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_TESTNET_RPC_URL: z.string().default("https://rpc.testnet.chain.robinhood.com"),

  // Neither chain has a known public Uniswap-V2-style DEX deployment wired in
  // here yet — set these once you've confirmed one exists (Robinhood Chain in
  // particular is built for tokenized stocks/RWAs, not permissionless meme
  // trading, and may not have one at all).
  MONAD_FACTORY_ADDRESS: z.string().optional().default(""),
  MONAD_ROUTER_ADDRESS: z.string().optional().default(""),
  MONAD_WRAPPED_NATIVE_ADDRESS: z.string().optional().default(""),
  ROBINHOOD_FACTORY_ADDRESS: z.string().optional().default(""),
  ROBINHOOD_ROUTER_ADDRESS: z.string().optional().default(""),
  ROBINHOOD_WRAPPED_NATIVE_ADDRESS: z.string().optional().default(""),

  // Flashbots Protect (Ethereum mainnet only): submits transactions through
  // Flashbots' RPC for frontrunning/revert protection instead of the public
  // mempool. Opt-in since it only makes sense on mainnet with real MEV risk.
  FLASHBOTS_ENABLED: boolFromString(false),
  FLASHBOTS_RPC_URL: z.string().default("https://rpc.flashbots.net"),

  // Jito (Solana mainnet only): bundles the swap with a tip transaction and
  // submits via Jito's Block Engine for MEV-protected/priority inclusion.
  // Opt-in for the same reason as Flashbots.
  JITO_ENABLED: boolFromString(false),
  JITO_BLOCK_ENGINE_URL: z
    .string()
    .default("https://mainnet.block-engine.jito.wtf/api/v1/bundles"),
  JITO_TIP_LAMPORTS: z.coerce.number().int().min(0).default(10_000),
  // Comma-separated Jito tip account pubkeys — verify against
  // https://docs.jito.wtf before relying on this with real size, tip accounts
  // do get rotated.
  JITO_TIP_ACCOUNTS: z
    .string()
    .default(
      "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5,HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    ),

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
  // Notional size (in the asset's own units, e.g. USDC) used when requesting
  // a real LI.FI quote to confirm the bridge cost — bridge fees aren't flat,
  // so this should roughly match the size Arbiter would actually move.
  ARBITER_QUOTE_SIZE: z.coerce.number().positive().default(1000),

  // AI features (Guard's qualitative final gate, Scout's tweet interpretation,
  // Router's periodic TP/SL reasoning) — all off by default since a working
  // Anthropic API key isn't guaranteed to exist yet. Everything degrades to
  // rule-based-only behavior when this is false.
  AI_FEATURES_ENABLED: boolFromString(false),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  // How often (ms) Router re-evaluates TP/SL for each open position via the
  // AI reasoning pass — separate from and much slower than the position
  // monitor's per-tick deterministic price check.
  AI_TP_SL_REVIEW_INTERVAL_MS: z.coerce.number().int().min(60_000).default(5 * 60_000),

  // X (Twitter) API v2 — Scout's KOL tracking. Bearer token required; the
  // tiers that support monitoring specific accounts' posts are paid.
  TWITTER_BEARER_TOKEN: z.string().optional().default(""),
  // Comma-separated X/Twitter handles (no @) Scout watches for token calls.
  KOL_TWITTER_HANDLES: z.string().optional().default(""),
  TWITTER_POLL_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),

  // Admin dashboard rule engine — how often (ms) every active Rule is
  // re-evaluated against every user.
  RULE_ENGINE_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
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
