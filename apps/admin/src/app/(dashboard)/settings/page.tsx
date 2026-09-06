import { getDb } from "@clawd/db";
import { loadConfig } from "@clawd/core";
import { requireAdminSession, hasRole } from "@/lib/auth";
import { updateSettingAction } from "@/lib/actions";

const TUNABLE_KEYS = [
  { key: "TAKE_PROFIT_PCT", label: "Take-profit %", hint: "Fraction above entry, e.g. 0.5 = +50%" },
  { key: "STOP_LOSS_PCT", label: "Stop-loss %", hint: "Fraction below entry, e.g. 0.2 = -20%" },
  {
    key: "MAX_CONCURRENT_POSITIONS_PER_CHAIN",
    label: "Max concurrent positions / chain",
    hint: "Integer",
  },
  { key: "PROFIT_FEE_RATE", label: "Profit fee rate", hint: "Fraction, e.g. 0.02 = 2%" },
  {
    key: "CASHBACK_RATE_PCT",
    label: "Rewards Hub: cashback rate",
    hint: "Fraction, e.g. 0.2 = 20%. Blank/0 = shown as 'not configured yet' — no fabricated rate.",
  },
  {
    key: "REFERRAL_COMMISSION_PCT",
    label: "Rewards Hub: referral commission rate",
    hint: "Fraction, e.g. 0.3 = 30%. Blank/0 = shown as 'not configured yet' — no fabricated rate.",
  },
  { key: "SNIPER_ENABLED", label: "Sniper enabled", hint: "true / false" },
  { key: "SCOUT_ENABLED", label: "Scout enabled", hint: "true / false" },
  { key: "ARBITER_ENABLED", label: "Arbiter enabled (detection log)", hint: "true / false" },
  {
    key: "TRADING_PAUSED",
    label: "Trading paused (circuit breaker)",
    hint: "true / false — auto-set on a drawdown breach; set to false here to resume",
  },
  { key: "DRAWDOWN_THRESHOLD_PCT", label: "Drawdown pause threshold", hint: "Fraction, e.g. 0.3 = 30%" },
  {
    key: "MAX_PORTFOLIO_EXPOSURE_PCT",
    label: "Max portfolio exposure",
    hint: "Fraction of total portfolio value a single chain's open positions can occupy, e.g. 0.6 = 60%",
  },
  {
    key: "KELLY_FRACTION",
    label: "Kelly fraction (dynamic sizing)",
    hint: "Fraction of full-Kelly to size at, e.g. 0.25 = quarter-Kelly",
  },
  {
    key: "MAX_POSITION_SIZE_PCT",
    label: "Max position size",
    hint: "Hard per-trade ceiling as a fraction of the wallet's available balance",
  },
  {
    key: "GUARD_DRIFT_ALERT_THRESHOLD_PCT",
    label: "Guard drift alert threshold",
    hint: "Rolling accuracy drop below baseline that triggers a drift warning, e.g. 0.15 = 15%",
  },
  {
    key: "GUARD_DRIFT_ROLLING_WINDOW_SIZE",
    label: "Guard drift rolling window size",
    hint: "Integer — number of recent closed positions the drift report evaluates",
  },
  {
    key: "ARBITER_MIN_SPREAD_PCT",
    label: "Arbiter min spread",
    hint: "Minimum cross-chain spread (after bridge cost) to log an opportunity, e.g. 0.01 = 1%",
  },
  {
    key: "ARBITER_ASSUMED_BRIDGE_COST_PCT",
    label: "Arbiter assumed bridge cost",
    hint: "Fixed guess used for the cheap first-pass filter before a real LI.FI quote confirms it",
  },
  {
    key: "ARBITER_QUOTE_SIZE",
    label: "Arbiter quote size",
    hint: "Notional size (in the asset's own units, e.g. USDC) used when requesting a real LI.FI quote",
  },
  {
    key: "AI_FEATURES_ENABLED",
    label: "AI features enabled",
    hint: "true / false — Guard's AI gate, Scout's tweet interpretation, Router's TP/SL reasoning. Still needs ANTHROPIC_API_KEY set in .env.",
  },
  {
    key: "FLASHBOTS_ENABLED",
    label: "Flashbots enabled (Ethereum mainnet)",
    hint: "true / false — submit EVM swaps through Flashbots Protect instead of the public mempool",
  },
  {
    key: "JITO_ENABLED",
    label: "Jito enabled (Solana mainnet)",
    hint: "true / false — submit Solana swaps as a Jito bundle for MEV-protected/priority inclusion",
  },
  {
    key: "JITO_TIP_LAMPORTS",
    label: "Jito tip (lamports)",
    hint: "Integer — tip amount attached to each Jito bundle",
  },
  {
    key: "TREASURY_ADDRESS_SOLANA",
    label: "Treasury address · Solana",
    hint: "Fees on Solana are swept here on every profitable close. Blank = fees stay in the user's wallet.",
  },
  {
    key: "TREASURY_ADDRESS_ETHEREUM",
    label: "Treasury address · Ethereum",
    hint: "Fees on Ethereum are swept here on every profitable close. Blank = fees stay in the user's wallet.",
  },
  {
    key: "TREASURY_ADDRESS_BSC",
    label: "Treasury address · BSC",
    hint: "Fees on BSC are swept here on every profitable close. Blank = fees stay in the user's wallet.",
  },
  {
    key: "TREASURY_ADDRESS_BASE",
    label: "Treasury address · Base",
    hint: "Fees on Base are swept here on every profitable close. Blank = fees stay in the user's wallet.",
  },
  {
    key: "TREASURY_ADDRESS_MONAD",
    label: "Treasury address · Monad",
    hint: "Fees on Monad are swept here on every profitable close. Blank = fees stay in the user's wallet.",
  },
  {
    key: "TREASURY_ADDRESS_ROBINHOOD",
    label: "Treasury address · Robinhood Chain",
    hint: "Fees on Robinhood Chain are swept here on every profitable close. Blank = fees stay in the user's wallet.",
  },
  { key: "BOT_WEBSITE_URL", label: "Bot: website link", hint: "Shown in the bot's Info/description" },
  { key: "BOT_DOCS_URL", label: "Bot: docs link", hint: "Shown in the bot's Info/description" },
  { key: "BOT_CHANNEL_URL", label: "Bot: announcement channel link", hint: "Shown in the bot's Info/description" },
  {
    key: "BOT_SUPPORT_URL",
    label: "Bot: support link",
    hint: "Where the Support button sends users. Blank = falls back to the admin Telegram link below.",
  },
  {
    key: "BOT_ADMIN_TELEGRAM_URL",
    label: "Bot: admin Telegram link (fallback)",
    hint: "e.g. https://t.me/your_admin_handle — used only if Support link above is blank",
  },
  {
    key: "BOT_AD_MEDIA_URL",
    label: "Bot: ad video/GIF URL",
    hint: "A hosted video/GIF URL shown above every bot message. Blank = no ad.",
  },
  {
    key: "STABLECOIN_USDC_ADDRESS_SOLANA",
    label: "USDC address · Solana",
    hint: "SPL mint address. Blank = USDC not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDC_ADDRESS_ETHEREUM",
    label: "USDC address · Ethereum",
    hint: "ERC20 contract address. Blank = USDC not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDC_ADDRESS_BSC",
    label: "USDC address · BSC",
    hint: "ERC20 contract address. Blank = USDC not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDC_ADDRESS_BASE",
    label: "USDC address · Base",
    hint: "ERC20 contract address. Blank = USDC not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDC_ADDRESS_MONAD",
    label: "USDC address · Monad",
    hint: "ERC20 contract address. Blank = USDC not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDC_ADDRESS_ROBINHOOD",
    label: "USDC address · Robinhood Chain",
    hint: "ERC20 contract address. Blank = USDC not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDT_ADDRESS_SOLANA",
    label: "USDT address · Solana",
    hint: "SPL mint address. Blank = USDT not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDT_ADDRESS_ETHEREUM",
    label: "USDT address · Ethereum",
    hint: "ERC20 contract address. Blank = USDT not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDT_ADDRESS_BSC",
    label: "USDT address · BSC",
    hint: "ERC20 contract address. Blank = USDT not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDT_ADDRESS_BASE",
    label: "USDT address · Base",
    hint: "ERC20 contract address. Blank = USDT not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDT_ADDRESS_MONAD",
    label: "USDT address · Monad",
    hint: "ERC20 contract address. Blank = USDT not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "STABLECOIN_USDT_ADDRESS_ROBINHOOD",
    label: "USDT address · Robinhood Chain",
    hint: "ERC20 contract address. Blank = USDT not offered in Wallet > Transfer > Transfer Currency on this chain.",
  },
  {
    key: "NUDGE_MESSAGES_ENABLED",
    label: "Re-engagement nudges enabled",
    hint: "true / false — the automatic cadence. Manual sends from the Nudges page work either way.",
  },
  {
    key: "NUDGE_COOLDOWN_HOURS",
    label: "Re-engagement nudge cooldown",
    hint: "Hours between automatic nudges to the same user, e.g. 24",
  },
  {
    key: "NUDGE_MAX_COUNT",
    label: "Re-engagement nudge cap",
    hint: "Max automatic nudges per user before it stops on its own, e.g. 5",
  },
] as const;

export default async function SettingsPage() {
  const session = await requireAdminSession();
  const canOperate = hasRole(session.role, "operator");
  const cfg = loadConfig();
  const overrides = await getDb().setting.findMany();
  const overrideMap = new Map(overrides.map((o) => [o.key, o.value]));

  const envDefaults: Record<string, string> = {
    TAKE_PROFIT_PCT: String(cfg.TAKE_PROFIT_PCT),
    STOP_LOSS_PCT: String(cfg.STOP_LOSS_PCT),
    MAX_CONCURRENT_POSITIONS_PER_CHAIN: String(cfg.MAX_CONCURRENT_POSITIONS_PER_CHAIN),
    PROFIT_FEE_RATE: String(cfg.PROFIT_FEE_RATE),
    CASHBACK_RATE_PCT: String(cfg.CASHBACK_RATE_PCT),
    REFERRAL_COMMISSION_PCT: String(cfg.REFERRAL_COMMISSION_PCT),
    SNIPER_ENABLED: "true",
    SCOUT_ENABLED: "true",
    ARBITER_ENABLED: "true",
    TRADING_PAUSED: "false",
    DRAWDOWN_THRESHOLD_PCT: String(cfg.DRAWDOWN_THRESHOLD_PCT),
    MAX_PORTFOLIO_EXPOSURE_PCT: String(cfg.MAX_PORTFOLIO_EXPOSURE_PCT),
    KELLY_FRACTION: String(cfg.KELLY_FRACTION),
    MAX_POSITION_SIZE_PCT: String(cfg.MAX_POSITION_SIZE_PCT),
    GUARD_DRIFT_ALERT_THRESHOLD_PCT: String(cfg.GUARD_DRIFT_ALERT_THRESHOLD_PCT),
    GUARD_DRIFT_ROLLING_WINDOW_SIZE: String(cfg.GUARD_DRIFT_ROLLING_WINDOW_SIZE),
    ARBITER_MIN_SPREAD_PCT: String(cfg.ARBITER_MIN_SPREAD_PCT),
    ARBITER_ASSUMED_BRIDGE_COST_PCT: String(cfg.ARBITER_ASSUMED_BRIDGE_COST_PCT),
    ARBITER_QUOTE_SIZE: String(cfg.ARBITER_QUOTE_SIZE),
    AI_FEATURES_ENABLED: String(cfg.AI_FEATURES_ENABLED),
    FLASHBOTS_ENABLED: String(cfg.FLASHBOTS_ENABLED),
    JITO_ENABLED: String(cfg.JITO_ENABLED),
    JITO_TIP_LAMPORTS: String(cfg.JITO_TIP_LAMPORTS),
    TREASURY_ADDRESS_SOLANA: "",
    TREASURY_ADDRESS_ETHEREUM: "",
    TREASURY_ADDRESS_BSC: "",
    TREASURY_ADDRESS_BASE: "",
    TREASURY_ADDRESS_MONAD: "",
    TREASURY_ADDRESS_ROBINHOOD: "",
    BOT_WEBSITE_URL: cfg.BOT_WEBSITE_URL,
    BOT_DOCS_URL: cfg.BOT_DOCS_URL,
    BOT_CHANNEL_URL: cfg.BOT_CHANNEL_URL,
    BOT_SUPPORT_URL: cfg.BOT_SUPPORT_URL,
    BOT_ADMIN_TELEGRAM_URL: cfg.BOT_ADMIN_TELEGRAM_URL,
    BOT_AD_MEDIA_URL: cfg.BOT_AD_MEDIA_URL,
    NUDGE_MESSAGES_ENABLED: String(cfg.NUDGE_MESSAGES_ENABLED),
    NUDGE_COOLDOWN_HOURS: String(cfg.NUDGE_COOLDOWN_HOURS),
    NUDGE_MAX_COUNT: String(cfg.NUDGE_MAX_COUNT),
  };

  return (
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Live Settings</h1>
        <p className="text-sm text-white/60">
          These override the .env defaults immediately, no restart needed. Clear the field and save
          to fall back to the env value again.
        </p>
        <div className="card divide-y divide-border">
          {TUNABLE_KEYS.map(({ key, label, hint }) => {
            const override = overrideMap.get(key);
            const effective = override ?? envDefaults[key];
            return (
              <div key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-white/40">{hint}</div>
                  <div className="text-xs text-white/50">
                    Effective: <span className="font-mono">{effective || "(blank)"}</span>
                    {override ? "" : " (default)"}
                  </div>
                </div>
                {canOperate ? (
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      await updateSettingAction(key, String(formData.get("value") ?? ""));
                    }}
                    className="flex items-center gap-2"
                  >
                    <input name="value" defaultValue={override ?? ""} placeholder={envDefaults[key]} className="input w-32" />
                    <button type="submit" className="btn btn-secondary">
                      Save
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      </main>
  );
}
