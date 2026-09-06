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
  // Chat the bot DMs platform-level alerts to (circuit-breaker trips, Guard
  // accuracy drift) — see apps/bot/src/notifications.ts. A group/channel id
  // (negative, e.g. "-1002402221199") or a user id. Optional — alerts are
  // just skipped (with a log line) if unset.
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional().default(""),

  // Bot onboarding (apps/bot/src/conversations/onboarding.ts) — minimum
  // portfolio USD value (apps/bot/src/portfolio.ts) required before the
  // "Activate" button will turn a user's wallets on. Setting-overridable
  // like the other risk-management thresholds.
  MIN_DEPOSIT_USD: z.coerce.number().min(0).default(100),
  // How long the one-time private-key-reveal message at wallet creation
  // stays up before auto-deleting (the user can also delete it early via
  // its "Saved. Delete now." button). Same mechanism as /export's reveal.
  KEY_REVEAL_AUTO_DELETE_SECONDS: z.coerce.number().int().min(10).default(300),
  // Links shown on the bot's "Support" menu screen — left blank by default;
  // the screen just says "not configured yet" until these are set. Never
  // fabricate these.
  BOT_WEBSITE_URL: z.string().optional().default(""),
  BOT_DOCS_URL: z.string().optional().default(""),
  BOT_CHANNEL_URL: z.string().optional().default(""),
  BOT_SUPPORT_URL: z.string().optional().default(""),
  // Fallback destination for the bot's Support button when BOT_SUPPORT_URL
  // isn't set — e.g. a t.me link to the operator's own account.
  BOT_ADMIN_TELEGRAM_URL: z.string().optional().default(""),
  // URL to a hosted video/GIF the bot attaches above every message it sends
  // (as the message's media, with the text as its caption). Optional — no
  // behavior change (plain text messages) until an admin sets this.
  BOT_AD_MEDIA_URL: z.string().optional().default(""),

  // Re-engagement nudges (apps/bot/src/reengagement.ts) for onboarded users
  // who never activated a wallet. The check interval is startup-only, like
  // the other *_INTERVAL_MS values; the per-user 24h/5-max cadence is
  // enforced against User.lastNudgedAt/nudgeCount, not by this interval
  // directly — it's kept short so an admin's manual "send now" (queued via
  // User.pendingManualNudgeMessageId) delivers promptly.
  NUDGE_CHECK_INTERVAL_MS: z.coerce.number().int().min(60_000).default(5 * 60_000),
  NUDGE_COOLDOWN_HOURS: z.coerce.number().min(1).default(24),
  NUDGE_MAX_COUNT: z.coerce.number().int().min(0).default(5),
  NUDGE_MESSAGES_ENABLED: boolFromString(true),

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
  // Comma-separated secondary RPC endpoints — a request that fails against
  // the primary above retries against these, in order, before failing the
  // whole call (see packages/chains/src/rpc-failover.ts). Optional; no
  // failover happens if left empty.
  SOLANA_DEVNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  SOLANA_MAINNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
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

  // Comma-separated secondary RPC endpoints per chain/network — a request
  // that fails against the primary retries against these, in order, before
  // failing the whole call (see packages/chains/src/evm/transport.ts).
  // Optional; no failover happens if left empty.
  ETHEREUM_TESTNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  ETHEREUM_MAINNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  BSC_TESTNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  BSC_MAINNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  BASE_TESTNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  BASE_MAINNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  MONAD_TESTNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  MONAD_MAINNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  ROBINHOOD_TESTNET_RPC_FALLBACK_URLS: z.string().optional().default(""),
  ROBINHOOD_MAINNET_RPC_FALLBACK_URLS: z.string().optional().default(""),

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

  // Etherscan's V2 multichain API (one key, `chainid` query param selects
  // ethereum/bsc/base) — used by the admin dashboard's on-chain wallet
  // transaction history, display-only. Unset means that feature reports
  // "unsupported" rather than a fabricated empty history. Monad and
  // Robinhood Chain have no known Etherscan-compatible explorer, so they
  // report "unsupported" regardless of this key (see tx-history.ts).
  ETHERSCAN_API_KEY: z.string().optional().default(""),

  PROFIT_FEE_RATE: z.coerce.number().min(0).max(1).default(0.02),
  FEE_TREASURY_SOLANA_ADDRESS: z.string().optional().default(""),
  FEE_TREASURY_EVM_ADDRESS: z.string().optional().default(""),

  // Rewards Hub (bot menu.ts) — advertised cashback/referral commission
  // rates. Zero by default: no accrual ledger exists yet (balances always
  // show real $0, never fabricated), and the rate itself is a business
  // decision for the operator to set via the admin dashboard, not something
  // to guess from a competitor's marketing copy.
  CASHBACK_RATE_PCT: z.coerce.number().min(0).max(1).default(0),
  REFERRAL_COMMISSION_PCT: z.coerce.number().min(0).max(1).default(0),

  TAKE_PROFIT_PCT: z.coerce.number().min(0).default(0.5),
  STOP_LOSS_PCT: z.coerce.number().min(0).max(1).default(0.2),
  MAX_CONCURRENT_POSITIONS_PER_CHAIN: z.coerce.number().int().min(1).default(3),
  // Portfolio-level exposure cap: a new position is rejected if it would push
  // (existing open-position value + the new position) above this fraction of
  // the user's total portfolio value on that chain (open positions +
  // uninvested balance). See router/src/exposure.ts.
  MAX_PORTFOLIO_EXPOSURE_PCT: z.coerce.number().min(0).max(1).default(0.6),
  // Dynamic position sizing (fractional Kelly) — see router/src/sizing.ts.
  // 0.25 = quarter-Kelly, the conservative fraction most retail Kelly-sizing
  // guides land on (full Kelly is high-variance against noisy win-rate
  // estimates from a small trade sample).
  KELLY_FRACTION: z.coerce.number().min(0).max(1).default(0.25),
  // Hard per-trade ceiling regardless of what Kelly sizing computes, as a
  // fraction of the wallet's available (uninvested) balance.
  MAX_POSITION_SIZE_PCT: z.coerce.number().min(0).max(1).default(0.2),
  POSITION_MONITOR_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),

  // Circuit breaker — see router/src/circuit-breaker.ts and
  // drawdown-check.ts. Trips a global TRADING_PAUSED Setting (new trades
  // only; open positions still get monitored/closed normally) when realized
  // P&L on any chain has drawn down more than the threshold within the
  // rolling window. Only ever set to true automatically — clearing it back
  // to false is a deliberate admin-dashboard action (see settings page).
  DRAWDOWN_WINDOW_MS: z.coerce.number().int().min(60_000).default(24 * 60 * 60_000),
  DRAWDOWN_THRESHOLD_PCT: z.coerce.number().min(0).default(0.3),
  DRAWDOWN_CHECK_INTERVAL_MS: z.coerce.number().int().min(60_000).default(5 * 60_000),

  // Guard drift detection — see packages/specialists/guard/src/drift.ts and
  // drift-report.ts. Alert threshold and rolling-window size are tunable
  // live via the admin dashboard (Setting overrides); the check interval is
  // startup-only config, like the other *_INTERVAL_MS values below.
  GUARD_DRIFT_CHECK_INTERVAL_MS: z.coerce.number().int().min(60_000).default(30 * 60_000),
  GUARD_DRIFT_ALERT_THRESHOLD_PCT: z.coerce.number().min(0).max(1).default(0.15),
  GUARD_DRIFT_ROLLING_WINDOW_SIZE: z.coerce.number().int().min(1).default(50),

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

  // Admin dashboard auth — single operator account, not a multi-tenant admin
  // system. Generate the hash with the same scrypt helper the wallet
  // package uses for the export passphrase (see README).
  ADMIN_USERNAME: z.string().optional().default(""),
  ADMIN_PASSWORD_HASH: z.string().optional().default(""),
  ADMIN_SESSION_SECRET: z.string().optional().default(""),
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
