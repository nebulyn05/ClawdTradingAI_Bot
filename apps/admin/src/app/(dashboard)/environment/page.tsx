import { loadConfig } from "@clawd/core";

/** Shows only enough of a secret to confirm it's set, never enough to reconstruct it. */
function mask(value: string): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-xs text-white/60">{label}</span>
      <span className={`text-xs ${mono ? "font-mono" : ""} ${value === "(not set)" ? "text-white/30" : "text-white/80"}`}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="mb-2 text-sm font-semibold text-white/80">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

const CHAINS = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"] as const;
const CHAIN_LABEL: Record<(typeof CHAINS)[number], string> = {
  solana: "Solana",
  ethereum: "Ethereum",
  bsc: "BSC",
  base: "Base",
  monad: "Monad",
  robinhood: "Robinhood Chain",
};

export default async function EnvironmentPage() {
  const cfg = loadConfig();

  return (
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-lg font-semibold">Environment</h1>
          <p className="text-sm text-white/60">
            Read-only — these are process-boot config, not live Settings. Adapters, RPC clients, and
            third-party API clients are constructed once at startup and cached for the process's
            lifetime, so changing any of these requires editing .env and restarting the bot/worker
            processes. Secrets are masked. Trading thresholds and feature flags that <em>are</em> live
            (checked on every trade/request, not just at startup) live on the Settings page instead.
          </p>
        </div>

        <Section title="Networks">
          {CHAINS.map((c) => (
            <Row key={c} label={CHAIN_LABEL[c]} value={cfg[`${c.toUpperCase() as Uppercase<typeof c>}_NETWORK`]} mono={false} />
          ))}
        </Section>

        <Section title="Solana RPC">
          <Row label="Helius API key" value={mask(cfg.HELIUS_API_KEY)} />
          <Row label="Devnet RPC" value={cfg.SOLANA_DEVNET_RPC_URL} />
          <Row label="Mainnet RPC" value={cfg.SOLANA_MAINNET_RPC_URL || "(not set)"} />
          <Row label="Devnet fallback RPCs" value={cfg.SOLANA_DEVNET_RPC_FALLBACK_URLS || "(not set)"} />
          <Row label="Mainnet fallback RPCs" value={cfg.SOLANA_MAINNET_RPC_FALLBACK_URLS || "(not set)"} />
          <Row label="Jupiter API base" value={cfg.JUPITER_API_BASE} />
        </Section>

        <Section title="EVM RPC — provider keys">
          <Row label="Alchemy API key" value={mask(cfg.ALCHEMY_API_KEY)} />
          <Row label="QuickNode Ethereum URL" value={mask(cfg.QUICKNODE_ETHEREUM_URL)} />
          <Row label="QuickNode BSC URL" value={mask(cfg.QUICKNODE_BSC_URL)} />
          <Row label="QuickNode Base URL" value={mask(cfg.QUICKNODE_BASE_URL)} />
        </Section>

        {(["ethereum", "bsc", "base"] as const).map((chain) => {
          const C = chain.toUpperCase() as "ETHEREUM" | "BSC" | "BASE";
          return (
            <Section key={chain} title={`${CHAIN_LABEL[chain]} RPC & contracts`}>
              <Row label="Testnet RPC" value={cfg[`${C}_TESTNET_RPC_URL`]} />
              <Row label="Mainnet RPC" value={cfg[`${C}_MAINNET_RPC_URL`] || "(not set)"} />
              <Row label="Testnet fallback RPCs" value={cfg[`${C}_TESTNET_RPC_FALLBACK_URLS`] || "(not set)"} />
              <Row label="Mainnet fallback RPCs" value={cfg[`${C}_MAINNET_RPC_FALLBACK_URLS`] || "(not set)"} />
              <Row label="Testnet WS override" value={cfg[`${C}_TESTNET_WS_URL`] || "(auto-derived)"} />
              <Row label="Mainnet WS override" value={cfg[`${C}_MAINNET_WS_URL`] || "(auto-derived)"} />
              <Row label="Factory address" value={cfg[`${C}_FACTORY_ADDRESS`] || "(not set)"} />
              <Row label="Router address" value={cfg[`${C}_ROUTER_ADDRESS`] || "(not set)"} />
              <Row label="Wrapped native address" value={cfg[`${C}_WRAPPED_NATIVE_ADDRESS`] || "(not set)"} />
            </Section>
          );
        })}

        {(["monad", "robinhood"] as const).map((chain) => {
          const C = chain.toUpperCase() as "MONAD" | "ROBINHOOD";
          return (
            <Section key={chain} title={`${CHAIN_LABEL[chain]} RPC & contracts`}>
              <Row label="Testnet RPC" value={cfg[`${C}_TESTNET_RPC_URL`] || "(not set)"} />
              <Row label="Mainnet RPC" value={cfg[`${C}_MAINNET_RPC_URL`]} />
              <Row label="Testnet fallback RPCs" value={cfg[`${C}_TESTNET_RPC_FALLBACK_URLS`] || "(not set)"} />
              <Row label="Mainnet fallback RPCs" value={cfg[`${C}_MAINNET_RPC_FALLBACK_URLS`] || "(not set)"} />
              <Row label="Testnet WS override" value={cfg[`${C}_TESTNET_WS_URL`] || "(auto-derived)"} />
              <Row label="Mainnet WS override" value={cfg[`${C}_MAINNET_WS_URL`] || "(auto-derived)"} />
              <Row label="Factory address" value={cfg[`${C}_FACTORY_ADDRESS`] || "(not set — no known V2 DEX deployment)"} />
              <Row label="Router address" value={cfg[`${C}_ROUTER_ADDRESS`] || "(not set)"} />
              <Row label="Wrapped native address" value={cfg[`${C}_WRAPPED_NATIVE_ADDRESS`] || "(not set)"} />
            </Section>
          );
        })}

        <Section title="Aggregators & pricing">
          <Row label="1inch API key" value={mask(cfg.ONEINCH_API_KEY)} />
          <Row label="Birdeye API key" value={mask(cfg.BIRDEYE_API_KEY)} />
          <Row label="DexScreener API base" value={cfg.DEXSCREENER_API_BASE} />
          <Row label="LI.FI API key" value={mask(cfg.LIFI_API_KEY)} />
          <Row label="Etherscan API key (tx history)" value={mask(cfg.ETHERSCAN_API_KEY)} />
        </Section>

        <Section title="MEV protection">
          <Row label="Flashbots RPC URL" value={cfg.FLASHBOTS_RPC_URL} />
          <Row label="Jito block engine URL" value={cfg.JITO_BLOCK_ENGINE_URL} />
          <Row label="Jito tip accounts" value={cfg.JITO_TIP_ACCOUNTS} />
        </Section>

        <Section title="AI (Anthropic)">
          <Row label="API key" value={mask(cfg.ANTHROPIC_API_KEY)} />
          <Row label="Model" value={cfg.ANTHROPIC_MODEL} />
        </Section>

        <Section title="Scout / KOL tracking">
          <Row label="Twitter bearer token" value={mask(cfg.TWITTER_BEARER_TOKEN)} />
          <Row label="Watched handles" value={cfg.KOL_TWITTER_HANDLES || "(not set)"} />
        </Section>

        <Section title="Telegram">
          <Row label="Bot token" value={mask(cfg.TELEGRAM_BOT_TOKEN)} />
          <Row label="Admin alert chat id" value={cfg.TELEGRAM_ADMIN_CHAT_ID || "(not set)"} />
        </Section>

        <Section title="Background job intervals (ms unless noted)">
          <Row label="Position monitor" value={String(cfg.POSITION_MONITOR_INTERVAL_MS)} />
          <Row label="Drawdown check" value={String(cfg.DRAWDOWN_CHECK_INTERVAL_MS)} />
          <Row label="Drawdown rolling window" value={String(cfg.DRAWDOWN_WINDOW_MS)} />
          <Row label="Guard drift check" value={String(cfg.GUARD_DRIFT_CHECK_INTERVAL_MS)} />
          <Row label="Arbiter scan" value={String(cfg.ARBITER_SCAN_INTERVAL_MS)} />
          <Row label="AI TP/SL review" value={String(cfg.AI_TP_SL_REVIEW_INTERVAL_MS)} />
          <Row label="Twitter poll" value={String(cfg.TWITTER_POLL_INTERVAL_MS)} />
          <Row label="Rule engine" value={String(cfg.RULE_ENGINE_INTERVAL_MS)} />
          <Row label="Key-reveal auto-delete (seconds)" value={String(cfg.KEY_REVEAL_AUTO_DELETE_SECONDS)} />
        </Section>

        <Section title="Connections">
          <Row label="Database" value={cfg.DATABASE_URL ? "configured" : "(not set)"} mono={false} />
          <Row label="Redis" value={cfg.REDIS_URL ? "configured" : "(not set)"} mono={false} />
          <Row label="Log level" value={cfg.LOG_LEVEL} mono={false} />
        </Section>
      </main>
  );
}
