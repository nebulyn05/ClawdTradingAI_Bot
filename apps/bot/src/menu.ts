import { Bot, InlineKeyboard } from "grammy";
import { loadConfig, getNumberSetting, getSetting, type Chain } from "@clawd/core";
import { formatTokenAmount } from "@clawd/chains";
import type { BotContext } from "./types.js";
import { NATIVE_SYMBOL, CHAIN_ICON, CHAIN_LABEL } from "./chain-labels.js";
import {
  listWallets,
  setWalletActive,
  parseNativeAmount,
  regenerateWallet,
  getWalletOverrides,
  setBuyAmountOverride,
  setSlippageOverride,
  getUserSettings,
  updateUserSettings,
  resetUserSettings,
  getReferralStats,
  getStablecoinAddress,
  STABLECOIN_SYMBOLS,
  getTokenBalanceForWallet,
} from "./wallet-service.js";
import {
  getPortfolioSummary,
  getClosedPositions,
  getTradeHistory,
  getPnlBreakdown,
} from "./portfolio.js";

interface MenuView {
  text: string;
  keyboard: InlineKeyboard;
}

const BUY_AMOUNT_PRESETS: Record<Chain, number[]> = {
  solana: [0.1, 0.5, 1, 5, 10],
  ethereum: [0.01, 0.05, 0.1, 0.5, 1],
  bsc: [0.01, 0.05, 0.1, 0.5, 1],
  base: [0.01, 0.05, 0.1, 0.5, 1],
  monad: [0.1, 0.5, 1, 5, 10],
  robinhood: [0.01, 0.05, 0.1, 0.5, 1],
};

const SLIPPAGE_PRESETS_BPS = [50, 100, 200, 500, 1000, 1500]; // 0.5% .. 15%
const STOP_LOSS_PRESETS = [0.1, 0.2, 0.3, 0.5];
const TAKE_PROFIT_PRESETS = [0.5, 1, 2, 5];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backKeyboard(target = "menu:main"): InlineKeyboard {
  return new InlineKeyboard().text("⬅ Back", target);
}

/**
 * The rich balance/address/links block shown as the body of BOTH the main
 * /start dashboard and the Wallet screen (see reference screenshots — the
 * two views share this exact content, differing only in the button row
 * below it). No wallets yet -> a short onboarding nudge instead.
 */
/** The balances + total + deposit-addresses block shared by the /start dashboard, the Wallet screen, and the Transfer chain-picker. */
async function renderBalancesAndAddressesBlock(userId: string): Promise<string | null> {
  const wallets = await listWallets(userId);
  if (wallets.length === 0) return null;

  const summary = await getPortfolioSummary(userId);
  const evmWallet = wallets.find((w) => w.chain !== "solana");
  const solWallet = wallets.find((w) => w.chain === "solana");

  const balanceLines = summary.perChain.map(
    (e) => `${CHAIN_ICON[e.chain]} ${CHAIN_LABEL[e.chain]}: ${e.formatted} (${e.usd !== null ? `$${e.usd.toFixed(2)}` : "$0"})`,
  );

  return (
    `${balanceLines.join("\n")}\n\n` +
    `🧧 Total: $${summary.totalUsd.toFixed(2)}\n\n` +
    (evmWallet ? `EVM:\n${evmWallet.address}\n` : "") +
    (solWallet ? `SOL:\n${solWallet.address}` : "")
  );
}

async function renderWalletHomeText(userId: string): Promise<string> {
  const block = await renderBalancesAndAddressesBlock(userId);
  if (block === null) {
    return "Clawd Agents\n\nNo wallets yet — run /start to create one.";
  }
  const wallets = await listWallets(userId);

  const cfg = loadConfig();
  const feeRate = await getNumberSetting("PROFIT_FEE_RATE", cfg.PROFIT_FEE_RATE);
  const minDepositUsd = await getNumberSetting("MIN_DEPOSIT_USD", cfg.MIN_DEPOSIT_USD);
  const [website, docs, channel] = await Promise.all([
    getSetting("BOT_WEBSITE_URL"),
    getSetting("BOT_DOCS_URL"),
    getSetting("BOT_CHANNEL_URL"),
  ]);
  const links = [website ?? cfg.BOT_WEBSITE_URL, docs ?? cfg.BOT_DOCS_URL, channel ?? cfg.BOT_CHANNEL_URL].filter(
    (l): l is string => Boolean(l),
  );

  const anyActive = wallets.some((w) => w.active);

  return (
    "Clawd Trading Bot\n\n" +
    `${block}\n\n` +
    `🐝 Fee: ${(feeRate * 100).toFixed(0)}% on profitable trades only. Zero on losses.\n\n` +
    (links.length > 0 ? `${links.join(" | ")}\n\n` : "") +
    (anyActive
      ? "🟢 Clawd Agent is active — scanning 6 chains 24/7."
      : `⚡ Deposit at least $${minDepositUsd.toFixed(0)} to activate the Clawd Agent.\nAny asset, any supported chain.`)
  );
}

async function renderMainMenuView(userId: string): Promise<MenuView> {
  const wallets = await listWallets(userId);
  const anyActive = wallets.some((w) => w.active);

  const keyboard = new InlineKeyboard()
    .text(anyActive ? "🟢 Active — tap to pause all" : "⚡ Activate Clawd Agent", "menu:activate")
    .row()
    .text("💰 Wallet", "menu:wallet")
    .text("📊 Portfolio", "menu:portfolio")
    .row()
    .text("⚙️ Settings", "menu:settings")
    .text("🎁 Rewards", "menu:rewards")
    .row()
    .text("ℹ️ Info", "menu:info")
    .text("💬 Support", "menu:support")
    .row()
    .text("🔄 Refresh", "menu:refresh");

  const text = await renderWalletHomeText(userId);
  return { text, keyboard };
}

async function renderWalletView(userId: string): Promise<MenuView> {
  const keyboard = new InlineKeyboard()
    .text("🔀 Transfer", "wallet:transfer")
    .text("💳 Deposit", "wallet:deposit")
    .row()
    .text("📥 Import a Wallet", "wallet:import")
    .text("🔑 Export Private Key", "wallet:export")
    .row()
    .text("🆕 Generate New Wallet", "wallet:generate")
    .row()
    .text("⬅ Back", "menu:main")
    .text("🔄 Refresh", "menu:wallet");

  const text = await renderWalletHomeText(userId);
  return { text, keyboard };
}

async function renderTransferChainListView(userId: string): Promise<MenuView> {
  const block = await renderBalancesAndAddressesBlock(userId);
  const text = `🔀 TRANSFER\n\n${block ?? "No wallets yet."}\n\nSelect source chain:`;
  return { text, keyboard: chainListKeyboard("wallet:transfer", "menu:wallet") };
}

async function renderTransferTypeView(userId: string, chain: Chain): Promise<MenuView> {
  const summary = await getPortfolioSummary(userId);
  const wallets = await listWallets(userId);
  const wallet = wallets.find((w) => w.chain === chain);
  const entry = summary.perChain.find((e) => e.chain === chain);

  const text =
    `🔀 TRANSFER · ${CHAIN_LABEL[chain]}\n\n` +
    `Balance: ${entry ? entry.formatted : "0"} ${NATIVE_SYMBOL[chain]} (${entry?.usd !== null && entry?.usd !== undefined ? `$${entry.usd.toFixed(2)}` : "$0"})\n` +
    `Address:\n${wallet?.address ?? "—"}\n\n` +
    "Select transfer type:";

  const keyboard = new InlineKeyboard()
    .text("💵 Transfer Currency", `wallet:transfer:${chain}:currency`)
    .text("🪙 Transfer Token", `wallet:transfer:${chain}:token`)
    .row()
    .text("⬅ Back", "wallet:transfer");

  return { text, keyboard };
}

/**
 * "Transfer Currency" step 1/3 — native asset always offered; stablecoins
 * only appear if an admin has configured a real contract/mint address for
 * them on this chain (see wallet-service.ts's getStablecoinAddress) — never
 * a fabricated button for an address we don't actually have.
 */
export async function renderTransferCurrencyView(userId: string, chain: Chain): Promise<MenuView> {
  const summary = await getPortfolioSummary(userId);
  const nativeEntry = summary.perChain.find((e) => e.chain === chain);

  const keyboard = new InlineKeyboard();
  keyboard.text(`${NATIVE_SYMBOL[chain]} (${nativeEntry?.formatted ?? "0"})`, `wallet:transfer:${chain}:currency:native`).row();

  for (const symbol of STABLECOIN_SYMBOLS) {
    const tokenAddress = await getStablecoinAddress(chain, symbol);
    if (!tokenAddress) continue;
    try {
      const info = await getTokenBalanceForWallet(userId, chain, tokenAddress);
      keyboard
        .text(`${symbol.toUpperCase()} (${formatTokenAmount(info.balance, info.decimals)})`, `wallet:transfer:${chain}:currency:${symbol}`)
        .row();
    } catch {
      // Configured address is bad/unreachable right now — skip the button rather than show a broken one.
    }
  }

  keyboard.text("⬅ Back", `wallet:transfer:${chain}`);

  const text =
    "💱 Transfer Currency (1 / 3)\n\n" +
    "👛 Wallet: Primary\n" +
    `🌐 Chain: ${CHAIN_ICON[chain]} ${CHAIN_LABEL[chain]}\n\n` +
    "💵 Select the currency:";

  return { text, keyboard };
}

async function renderDepositView(userId: string): Promise<MenuView> {
  const summary = await getPortfolioSummary(userId);
  const wallets = await listWallets(userId);
  const evmWallet = wallets.find((w) => w.chain !== "solana");
  const solWallet = wallets.find((w) => w.chain === "solana");
  const anyActive = wallets.some((w) => w.active);

  const balanceLines = summary.perChain.map(
    (e) => `${CHAIN_ICON[e.chain]} ${CHAIN_LABEL[e.chain]}: ${e.formatted} (${e.usd !== null ? `$${e.usd.toFixed(2)}` : "$0"})`,
  );

  const cfg = loadConfig();
  const minDepositUsd = await getNumberSetting("MIN_DEPOSIT_USD", cfg.MIN_DEPOSIT_USD);
  const docsUrl = (await getSetting("BOT_DOCS_URL")) ?? cfg.BOT_DOCS_URL;

  const text =
    "💳 Deposit\n\n" +
    "Fund your Clawd Agent by sending crypto to your deposit addresses below. Always use the correct " +
    "network for each asset.\n\n" +
    "🍅 Your balances\n" +
    `${balanceLines.join("\n")}\n` +
    `Total: $${summary.totalUsd.toFixed(2)}\n\n` +
    "⬇️ Deposit addresses\n\n" +
    (solWallet ? `SOL (Solana)\n${solWallet.address}\n\n` : "") +
    (evmWallet ? `EVM (Ethereum, BSC, Base, Monad, Robinhood)\n${evmWallet.address}\n\n` : "") +
    (docsUrl ? `📖 New here? Step-by-step deposit guide →\n${docsUrl}\n\n` : "") +
    "ℹ️ What is EVM? The shared standard behind Ethereum, BSC, Base, Monad, Robinhood — one EVM " +
    "address works on all five. Send the asset on any of those chains to the address above.\n\n" +
    "🪙 No crypto yet? Buy on Binance, Coinbase or Kraken, then send it here.\n\n" +
    (anyActive
      ? "🟢 Clawd Agent is active — deposits top up your trading balance any time."
      : `⚡ Deposit at least $${minDepositUsd.toFixed(0)} to activate the Clawd Agent. Any asset, any supported chain.\n\n` +
        `🔒 The $${minDepositUsd.toFixed(0)} is simply the minimum required to activate the agent and let it trade ` +
        "properly. It is not a subscription or a payment to us. Every cent stays in your wallet and remains " +
        "yours. We only take a 2% fee on winning trades, nothing on deposits or losses.");

  const keyboard = new InlineKeyboard()
    .text("⬅ Back", "menu:wallet")
    .text("🔄 Refresh", "wallet:deposit");

  return { text, keyboard };
}

const EXPORT_CONFIRM_TEXT =
  "🔑 Export Private Keys?\n\n" +
  "You're about to reveal the private keys that control your funds.\n\n" +
  "Before you continue:\n" +
  "• Never share your keys with anyone — not even support\n" +
  "• Anyone with these keys has full control of your wallet\n" +
  "• Write them on paper; avoid screenshots and cloud backups\n" +
  "• The message will auto-delete as a safety net\n\n" +
  "You'll still need your export passphrase on the next step.\n\n" +
  "Are you sure you want to export?";

function exportConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔒 Yes, reveal my keys", "wallet:export:confirm")
    .row()
    .text("❌ Cancel", "wallet:export:cancel");
}

const GENERATE_CONFIRM_TEXT =
  "⚠️ Are you sure you want to generate a new wallet?\n\n" +
  "This will replace your current wallet addresses with newly generated ones. All previous access " +
  "will be lost — but your trade history stays intact.\n\n" +
  "Press \"Confirm\" only if you're ready to continue.";

function generateConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", "wallet:generate:confirm")
    .row()
    .text("❌ Cancel", "wallet:generate:cancel");
}

async function renderPortfolioView(userId: string): Promise<MenuView> {
  const pnl = await getPnlBreakdown(userId);
  const totalTrades = pnl.wins + pnl.losses;
  const winRate = totalTrades > 0 ? `${((pnl.wins / totalTrades) * 100).toFixed(0)}%` : "—";

  const text =
    "📊 Portfolio\n\n" +
    `📅 Realized PnL 7D: $${pnl.usd7d.toFixed(2)}\n` +
    `Win Rate: ${winRate} (${pnl.wins}W / ${pnl.losses}L)\n` +
    `Trades: ${pnl.trades}\n\n` +
    (pnl.trades === 0
      ? "Your PnL card will populate automatically once the Clawd Agent opens its first position. " +
        "Funded wallets are eligible for activation."
      : "");

  const keyboard = new InlineKeyboard()
    .text("📈 History", "portfolio:history")
    .text("📈 Closed Positions", "portfolio:closed")
    .row()
    .text("📅 PnL", "portfolio:pnl")
    .row()
    .text("⬅ Back", "menu:main");

  return { text, keyboard };
}

async function renderTradeHistoryView(userId: string): Promise<MenuView> {
  const trades = await getTradeHistory(userId, 10);
  const text =
    trades.length === 0
      ? "📈 Trade History\n\nNo trades executed yet. Once the Clawd Agent is active and funded, every " +
        "entry and exit lands here with timestamps, size, and realized PnL."
      : "📈 Trade History\n\n" +
        trades
          .map(
            (t) =>
              `${t.side === "buy" ? "🟢 BUY" : "🔴 SELL"} ${t.chain} ${t.formattedAmount}` +
              `${t.profitable !== null ? (t.profitable ? " ✅" : " ❌") : ""}\n${t.createdAt.toLocaleString()}`,
          )
          .join("\n\n");
  return { text, keyboard: backKeyboard("menu:portfolio") };
}

async function renderClosedPositionsView(userId: string): Promise<MenuView> {
  const positions = await getClosedPositions(userId, 10);
  const text =
    positions.length === 0
      ? "📈 Closed Positions\n\nNo closed positions yet. Positions close automatically via Take-Profit, " +
        "Stop-Loss, or Rug-Guard triggers. Results will appear here the moment the first trade settles."
      : "📈 Closed Positions\n\n" +
        positions
          .map(
            (p) =>
              `${p.chain} ${p.tokenAddress.slice(0, 10)}… (${p.exitReason ?? "?"})\n` +
              `Entry ${p.entryPrice} → Exit ${p.exitPrice ?? "?"}`,
          )
          .join("\n\n");
  return { text, keyboard: backKeyboard("menu:portfolio") };
}

async function renderPnlView(userId: string): Promise<MenuView> {
  const pnl = await getPnlBreakdown(userId);
  const text =
    "📅 PnL Breakdown\n\n" +
    `24H: $${pnl.usd24h.toFixed(2)}\n` +
    `7D:  $${pnl.usd7d.toFixed(2)}\n` +
    `30D: $${pnl.usd30d.toFixed(2)}\n` +
    `ALL: $${pnl.usdAll.toFixed(2)}\n\n` +
    "Cumulative profit/loss, net of fees, converted at each chain's current price (not the price at " +
    "trade time). Updates as positions close.";
  return { text, keyboard: backKeyboard("menu:portfolio") };
}

// ── Settings ────────────────────────────────────────────────────────────

async function renderSettingsView(userId: string): Promise<MenuView> {
  const settings = await getUserSettings(userId);
  const text =
    "⚙️ SETTINGS\n\n" +
    "Configure your Clawd Agent: protection, execution, and preferences.\n\n" +
    `Stop-Loss: ${settings.stopLossPctOverride !== null ? `${(settings.stopLossPctOverride * 100).toFixed(0)}%` : "Auto"} · ` +
    `Take Profit: ${settings.takeProfitPctOverride !== null ? `${(settings.takeProfitPctOverride * 100).toFixed(0)}%` : "Auto"}\n\n` +
    "Auto parameters are calibrated by the Clawd Agent in real time.";

  const keyboard = new InlineKeyboard()
    .text("— Trading —", "noop")
    .row()
    .text("📐 Slippage", "settings:slippage")
    .text("⚡ Buy Amount", "settings:buyamount")
    .row()
    .text(`🛡 Stop-Loss: ${settings.stopLossPctOverride !== null ? `${(settings.stopLossPctOverride * 100).toFixed(0)}%` : "Auto"}`, "settings:stoploss")
    .text(`📈 Take Profit: ${settings.takeProfitPctOverride !== null ? `${(settings.takeProfitPctOverride * 100).toFixed(0)}%` : "Auto"}`, "settings:takeprofit")
    .row()
    .text("— Protection —", "noop")
    .row()
    .text(`${settings.ruggGuardEnabled ? "✅" : "⭕"} Rug Guard`, "settings:toggle:ruggGuard")
    .text(`${settings.antiMevEnabled ? "✅" : "⭕"} Anti-MEV`, "settings:toggle:antiMev")
    .row()
    .text(`${settings.alertsEnabled ? "✅" : "⭕"} Alerts`, "settings:toggle:alerts")
    .row()
    .text("— General —", "noop")
    .row()
    .text("🌐 Language", "settings:language")
    .text("🎁 Rewards", "menu:rewards")
    .row()
    .text("♻️ Reset Settings", "settings:reset")
    .row()
    .text("⬅ Back", "menu:main");

  return { text, keyboard };
}

function chainListKeyboard(prefix: string, backTarget: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  const chains: Chain[] = ["base", "ethereum", "bsc", "monad", "robinhood", "solana"];
  for (let i = 0; i < chains.length; i += 2) {
    const row = chains.slice(i, i + 2);
    for (const chain of row) kb.text(chain[0]!.toUpperCase() + chain.slice(1), `${prefix}:${chain}`);
    kb.row();
  }
  kb.text("⬅ Back", backTarget);
  return kb;
}

async function renderSlippageChainListView(): Promise<MenuView> {
  return {
    text: "📐 Slippage\n\nSelect a network to configure slippage.",
    keyboard: chainListKeyboard("settings:slippage", "menu:settings"),
  };
}

export async function renderSlippageChainView(userId: string, chain: Chain): Promise<MenuView> {
  const overrides = await getWalletOverrides(userId, chain);
  const buyLabel = overrides.slippageBuyBps !== null ? `${(overrides.slippageBuyBps / 100).toFixed(1)}%` : "Auto";
  const sellLabel = overrides.slippageSellBps !== null ? `${(overrides.slippageSellBps / 100).toFixed(1)}%` : "Auto";
  const text =
    `📐 Slippage · ${chain}\n\n` +
    `Set your slippage tolerance for buy and sell transactions on ${chain}.\n\n` +
    "Slippage is the maximum accepted difference between expected and actual price.\n\n" +
    "Setting Auto lets the agent calibrate it per trade.\n\n" +
    "⚠️ Only modify if you know what you are doing.";
  const keyboard = new InlineKeyboard()
    .text(`BUY · ${buyLabel}`, `settings:slippage:${chain}:buy`)
    .text(`SELL · ${sellLabel}`, `settings:slippage:${chain}:sell`)
    .row()
    .text("⬅ Back", "settings:slippage");
  return { text, keyboard };
}

function renderSlippageValueView(chain: Chain, side: "buy" | "sell"): MenuView {
  const keyboard = new InlineKeyboard();
  keyboard.text("Auto", `settings:slippage:${chain}:${side}:set:auto`);
  for (const bps of SLIPPAGE_PRESETS_BPS) {
    keyboard.text(`${(bps / 100).toFixed(1)}%`, `settings:slippage:${chain}:${side}:set:${bps}`);
  }
  keyboard.row().text("✏️ Custom", `settings:slippage:${chain}:${side}:custom`);
  keyboard.row().text("⬅ Back", `settings:slippage:${chain}`);
  return {
    text: `📐 Slippage · ${chain} · ${side.toUpperCase()}\n\nSelect a slippage value for ${chain} ${side.toUpperCase()}.`,
    keyboard,
  };
}

async function renderBuyAmountChainListView(): Promise<MenuView> {
  return {
    text: "⚡ Buy Amount\n\nSelect a network to configure buy amount.",
    keyboard: chainListKeyboard("settings:buyamount", "menu:settings"),
  };
}

export function renderBuyAmountValueView(chain: Chain, current: string | null): MenuView {
  const symbol = NATIVE_SYMBOL[chain];
  const keyboard = new InlineKeyboard();
  keyboard.text("Auto", `settings:buyamount:${chain}:set:auto`);
  const presets = BUY_AMOUNT_PRESETS[chain];
  for (let i = 0; i < presets.length; i += 3) {
    for (const amount of presets.slice(i, i + 3)) {
      keyboard.text(`${amount} ${symbol}`, `settings:buyamount:${chain}:set:${amount}`);
    }
    keyboard.row();
  }
  keyboard.text("✏️ Custom", `settings:buyamount:${chain}:custom`).row();
  keyboard.text("⬅ Back", "settings:buyamount");
  return {
    text:
      `⚡ Buy Amount · ${chain}\n\n` +
      `Current: ${current ?? "Auto"}\n\n` +
      "Select a buy amount for every new position on this chain.",
    keyboard,
  };
}

function renderStopLossView(current: number | null): MenuView {
  const keyboard = new InlineKeyboard();
  keyboard.text("Auto", "settings:stoploss:set:auto");
  for (const pct of STOP_LOSS_PRESETS) keyboard.text(`${(pct * 100).toFixed(0)}%`, `settings:stoploss:set:${pct}`);
  keyboard.row().text("⬅ Back to Settings", "menu:settings");
  return {
    text:
      "🛡 Stop-Loss\n\n" +
      `Current: ${current !== null ? `${(current * 100).toFixed(0)}%` : "Auto"}\n\n` +
      "Auto: calibrated per trade by the Clawd Agent.",
    keyboard,
  };
}

function renderTakeProfitView(current: number | null): MenuView {
  const keyboard = new InlineKeyboard();
  keyboard.text("Auto", "settings:takeprofit:set:auto");
  for (const pct of TAKE_PROFIT_PRESETS) keyboard.text(`${(pct * 100).toFixed(0)}%`, `settings:takeprofit:set:${pct}`);
  keyboard.row().text("⬅ Back to Settings", "menu:settings");
  return {
    text:
      "📈 Take Profit\n\n" +
      `Current: ${current !== null ? `${(current * 100).toFixed(0)}%` : "Auto"}\n\n` +
      "Auto: calibrated per trade by the Clawd Agent.",
    keyboard,
  };
}

const LANGUAGES: { code: string; flag: string }[] = [
  { code: "en", flag: "🇬🇧" },
  { code: "zh", flag: "🇨🇳" },
  { code: "tr", flag: "🇹🇷" },
  { code: "de", flag: "🇩🇪" },
  { code: "id", flag: "🇮🇩" },
  { code: "fr", flag: "🇫🇷" },
  { code: "pt", flag: "🇧🇷" },
  { code: "ko", flag: "🇰🇷" },
  { code: "es", flag: "🇪🇸" },
];

function renderLanguageView(current: string): MenuView {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < LANGUAGES.length; i += 5) {
    for (const lang of LANGUAGES.slice(i, i + 5)) {
      keyboard.text(`${lang.code === current ? "✅ " : ""}${lang.flag}`, `settings:language:set:${lang.code}`);
    }
    keyboard.row();
  }
  keyboard.text("⬅ Back", "menu:settings");
  return {
    text:
      "🌐 Language\n\nSelect your preferred language.\n\n" +
      "Note: only English text is available right now — other languages are selectable but not yet translated.",
    keyboard,
  };
}

// ── Rewards ─────────────────────────────────────────────────────────────

export async function renderRewardsView(userId: string, botUsername: string | undefined): Promise<MenuView> {
  const stats = await getReferralStats(userId);
  const link = botUsername ? `https://t.me/${botUsername}?start=r_${stats.referralCode}` : "(bot username unavailable)";

  const cfg = loadConfig();
  const [cashbackRate, referralRate] = await Promise.all([
    getNumberSetting("CASHBACK_RATE_PCT", cfg.CASHBACK_RATE_PCT),
    getNumberSetting("REFERRAL_COMMISSION_PCT", cfg.REFERRAL_COMMISSION_PCT),
  ]);

  const text =
    "🎁 REWARDS HUB\n\n" +
    `💵 CASHBACK: ${cashbackRate > 0 ? `${(cashbackRate * 100).toFixed(0)}%` : "not configured yet"}\n` +
    `🎗 REFERRAL: ${referralRate > 0 ? `${(referralRate * 100).toFixed(0)}%` : "not configured yet"}\n\n` +
    "🎗 REFERRAL\n" +
    `├ 🙌 Joined via your link: ${stats.referralCount} friends\n` +
    "├ 👝 Unclaimed: $0.00\n" +
    "└ ✅ Claimed: $0.00\n\n" +
    "💵 CASHBACK\n" +
    "├ 👝 Unclaimed: $0.00\n" +
    "└ ✅ Claimed: $0.00\n\n" +
    "⚙️ Referral Settings\n" +
    `🌐 Link: ${link}\n` +
    `# Code: ${stats.referralCode}\n\n` +
    "Cashback/referral accrual and payouts aren't live yet — this screen shows your real referral " +
    "link and signup count; balances will populate once the reward ledger is built.";

  const keyboard = new InlineKeyboard()
    .text("✏️ Custom Code", "rewards:customcode")
    .row()
    .text("💰 Claim Cashback", "rewards:claim:cashback")
    .text("💰 Claim Referral", "rewards:claim:referral")
    .row()
    .text("⬅ Back", "menu:main");

  return { text, keyboard };
}

function renderClaimView(kind: "cashback" | "referral"): MenuView {
  const label = kind === "cashback" ? "Cashback" : "Referral";
  const chains: Chain[] = ["base", "ethereum", "bsc", "monad", "robinhood", "solana"];
  const lines = chains.map((c) => `${c}: $0.000`).join("\n");
  return {
    text:
      `💰 Claim ${label} Rewards\n\n${lines}\n\n` +
      "Total: $0.000\n\n" +
      "Min $5 per chain to claim\n\n" +
      "No rewards to claim yet.",
    keyboard: backKeyboard("menu:rewards"),
  };
}

function renderInfoView(): MenuView {
  return {
    text:
      "ℹ️ Info\n\n" +
      "Clawd Agents is an autonomous trading agent across Solana, Ethereum, BSC, Base, Monad, " +
      "and Robinhood Chain. It screens tokens for safety (liquidity, mint/freeze authority, " +
      "honeypot checks), sizes positions dynamically from historical performance, and manages " +
      "take-profit/stop-loss automatically. A portfolio exposure cap and a drawdown circuit " +
      "breaker limit risk. MEV-protected execution is available via Jito (Solana) / Flashbots " +
      "(Ethereum mainnet) when enabled.\n\n" +
      "Fee: 2% on profitable trades only. Zero on losses.",
    keyboard: backKeyboard(),
  };
}

async function renderSupportView(): Promise<MenuView> {
  const cfg = loadConfig();
  const [website, docs, channel] = await Promise.all([
    getSetting("BOT_WEBSITE_URL"),
    getSetting("BOT_DOCS_URL"),
    getSetting("BOT_CHANNEL_URL"),
  ]);
  const links = [
    website ?? cfg.BOT_WEBSITE_URL ? `Website: ${website ?? cfg.BOT_WEBSITE_URL}` : null,
    docs ?? cfg.BOT_DOCS_URL ? `Docs: ${docs ?? cfg.BOT_DOCS_URL}` : null,
    channel ?? cfg.BOT_CHANNEL_URL ? `Channel: ${channel ?? cfg.BOT_CHANNEL_URL}` : null,
  ].filter((l): l is string => l !== null);
  return {
    text: `💬 Support\n\n${links.length > 0 ? links.join("\n") : "Not configured yet."}`,
    keyboard: backKeyboard(),
  };
}

/** Resolves the Support button's target: admin-configured support link, else admin-configured fallback, else none. */
async function resolveSupportUrl(): Promise<string | null> {
  const cfg = loadConfig();
  const support = (await getSetting("BOT_SUPPORT_URL")) ?? cfg.BOT_SUPPORT_URL;
  if (support) return support;
  const adminFallback = (await getSetting("BOT_ADMIN_TELEGRAM_URL")) ?? cfg.BOT_ADMIN_TELEGRAM_URL;
  return adminFallback || null;
}

async function renderView(ctx: BotContext, view: string): Promise<MenuView> {
  const userId = ctx.userId;
  switch (view) {
    case "menu:wallet":
      return renderWalletView(userId);
    case "wallet:deposit":
      return renderDepositView(userId);
    case "menu:portfolio":
      return renderPortfolioView(userId);
    case "portfolio:history":
      return renderTradeHistoryView(userId);
    case "portfolio:closed":
      return renderClosedPositionsView(userId);
    case "portfolio:pnl":
      return renderPnlView(userId);
    case "menu:settings":
      return renderSettingsView(userId);
    case "settings:slippage":
      return renderSlippageChainListView();
    case "settings:buyamount":
      return renderBuyAmountChainListView();
    case "menu:rewards":
      return renderRewardsView(userId, ctx.me?.username);
    case "menu:info":
      return renderInfoView();
    case "menu:support":
      return renderSupportView();
    default:
      return renderMainMenuView(userId);
  }
}

/** Sends the main menu as a new message — used at the end of onboarding and by /start for returning users. */
export async function renderMainMenu(ctx: BotContext): Promise<void> {
  const { text, keyboard } = await renderMainMenuView(ctx.userId);
  await ctx.reply(text, { reply_markup: keyboard });
}

/** Renders any named view as a new message — used by direct-access commands (/wallet, /settings, ...). */
export async function renderViewAsMessage(ctx: BotContext, view: string): Promise<void> {
  const { text, keyboard } = await renderView(ctx, view);
  await ctx.reply(text, { reply_markup: keyboard });
}

const ACTIVATE_CONFIRM_TEXT =
  "⚡ Activate Clawd Agent?\n\n" +
  "The agent will start scanning 6 chains 24/7 for trading opportunities the moment it's live.\n\n" +
  "🐝 Fee: 2% on profitable trades only. Zero on losses.\n\n" +
  "You can deactivate any time from the dashboard.";

function activateConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confirm & Activate", "activate:confirm").row().text("❌ Cancel", "activate:cancel");
}

async function handleActivateConfirmed(ctx: BotContext): Promise<void> {
  const userId = ctx.userId;

  await ctx
    .editMessageText(
      "🟡 Processing... (1/3)\n\n⚙️ Initializing Clawd Agent...\n\nEstablishing secure channel to data feeds.",
    )
    .catch(() => {});
  await sleep(1000);

  await ctx
    .editMessageText(
      "🟡 Processing... (2/3)\n\n💰 Checking wallet balance...\n\n" +
        "Reading balances across Solana, Ethereum, BNB, Base, Monad, and Robinhood.",
    )
    .catch(() => {});

  const cfg = loadConfig();
  const minDepositUsd = await getNumberSetting("MIN_DEPOSIT_USD", cfg.MIN_DEPOSIT_USD);
  const summary = await getPortfolioSummary(userId);
  await sleep(600);

  if (summary.totalUsd < minDepositUsd) {
    await ctx
      .editMessageText(
        "🔴 Transaction failed (3/3)\n\n" +
          "❌ Activation Failed\n\n" +
          `Your wallet balance is too low to activate the Clawd Agent.\nPlease deposit at least $${minDepositUsd}.\n\n` +
          `Current balance: $${summary.totalUsd.toFixed(2)}\n` +
          `Required minimum: $${minDepositUsd.toFixed(2)}`,
        { reply_markup: backKeyboard("menu:wallet") },
      )
      .catch(() => {});
    return;
  }

  const wallets = await listWallets(userId);
  await Promise.all(wallets.map((w) => setWalletActive(userId, w.chain, true)));

  await ctx
    .editMessageText("🟢 Activated (3/3)\n\n✅ Clawd Agent is live — scanning 6 chains 24/7.")
    .catch(() => {});
  await sleep(500);
  const { text, keyboard } = await renderView(ctx, "menu:main");
  await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
}

async function handleGenerateNewWallet(ctx: BotContext): Promise<void> {
  const userId = ctx.userId;
  const cfg = loadConfig();
  const ttlSeconds = cfg.KEY_REVEAL_AUTO_DELETE_SECONDS;

  await ctx.editMessageText("🔑 Generating your wallets...\n\nThis will take just a moment.").catch(() => {});

  const { rawKeys, previousRawKeys } = await regenerateWallet(userId);
  const wallets = await listWallets(userId);
  const evmWallet = wallets.find((w) => w.chain !== "solana");
  const solWallet = wallets.find((w) => w.chain === "solana");

  const hasPrevious = previousRawKeys.evm !== null || previousRawKeys.solana !== null;
  if (hasPrevious) {
    // The overwritten wallet's keys — the user's only remaining way to recover whatever was left in it.
    await ctx
      .editMessageText(
        "🔒 Keys from your previous wallet\n\n" +
          (previousRawKeys.evm ? `EVM:\n${previousRawKeys.evm}\n\n` : "") +
          (previousRawKeys.solana ? `SOL:\n${previousRawKeys.solana}\n\n` : "") +
          "🔵 Save these now. These keys are your only way to recover funds from the previous wallet — " +
          "write them on paper, never screenshot.\n\n" +
          `This message auto-deletes in ${Math.round(ttlSeconds / 60)} minutes.`,
        { reply_markup: new InlineKeyboard().text("🗑️ Saved. Delete now.", "onboarding:delete_keys") },
      )
      .catch(() => {});
    const confirmMsg = ctx.callbackQuery?.message;
    if (confirmMsg) {
      setTimeout(() => {
        ctx.api.deleteMessage(confirmMsg.chat.id, confirmMsg.message_id).catch(() => {});
      }, ttlSeconds * 1000);
    }
  }

  const addressLines = [
    evmWallet ? `EVM: ${evmWallet.address}` : null,
    solWallet ? `SOL: ${solWallet.address}` : null,
  ].filter((l): l is string => l !== null);

  const generatedText = `Wallet Generated\n\n${addressLines.join("\n")}`;
  if (hasPrevious) {
    await ctx.reply(generatedText);
  } else {
    await ctx.editMessageText(generatedText).catch(() => {});
  }

  const sent = await ctx.reply(
    "🔐 Your Private Keys · Save Now\n\n" +
      `EVM Private Key:\n${rawKeys.evm}\n\n` +
      `SOL Private Key:\n${rawKeys.solana}\n\n` +
      "⚠️ Write it down. Never screenshot. Never share.\n" +
      `Auto-deletes in ${Math.round(ttlSeconds / 60)} minutes.`,
    { reply_markup: new InlineKeyboard().text("🗑️ Saved. Delete now.", "onboarding:delete_keys") },
  );
  setTimeout(() => {
    ctx.api.deleteMessage(sent.chat.id, sent.message_id).catch(() => {});
  }, ttlSeconds * 1000);
}

/** Parses a trailing numeric/"auto" segment off callback data, e.g. "settings:stoploss:set:0.2" -> 0.2, "...set:auto" -> null. */
function parseAutoOrNumber(raw: string): number | null {
  if (raw === "auto") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Registers every callback-query handler for the persistent menu. Call once from bot.ts. */
export function registerMenuHandlers(bot: Bot<BotContext>): void {
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("onboarding:delete_keys", async (ctx) => {
    await ctx.answerCallbackQuery("Deleted.");
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery("wallet:transfer", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await renderTransferChainListView(ctx.userId);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^wallet:transfer:[a-z]+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chain = ctx.callbackQuery.data.split(":")[2] as Chain;
    const { text, keyboard } = await renderTransferTypeView(ctx.userId, chain);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^wallet:transfer:[a-z]+:currency$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chain = ctx.callbackQuery.data.split(":")[2] as Chain;
    const { text, keyboard } = await renderTransferCurrencyView(ctx.userId, chain);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^wallet:transfer:[a-z]+:currency:(native|usdc|usdt)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.split(":");
    const chain = parts[2] as Chain;
    const symbol = parts[4] as "native" | "usdc" | "usdt";
    ctx.session.transferChain = chain;
    ctx.session.transferCurrency = symbol;
    await ctx.conversation.enter("transferCurrency");
  });

  bot.callbackQuery(/^wallet:transfer:[a-z]+:token$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chain = ctx.callbackQuery.data.split(":")[2] as Chain;
    ctx.session.transferChain = chain;
    await ctx.conversation.enter("transferToken");
  });

  bot.callbackQuery("wallet:import", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("importWallet");
  });

  bot.callbackQuery("wallet:export", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(EXPORT_CONFIRM_TEXT, { reply_markup: exportConfirmKeyboard() }).catch(() => {});
  });

  bot.callbackQuery("wallet:export:confirm", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("exportKey");
  });

  bot.callbackQuery("wallet:export:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await renderView(ctx, "menu:wallet");
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("wallet:generate", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(GENERATE_CONFIRM_TEXT, { reply_markup: generateConfirmKeyboard() }).catch(() => {});
  });

  bot.callbackQuery("wallet:generate:confirm", async (ctx) => {
    await ctx.answerCallbackQuery("Generating...");
    await handleGenerateNewWallet(ctx);
  });

  bot.callbackQuery("wallet:generate:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await renderView(ctx, "menu:wallet");
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("menu:activate", async (ctx) => {
    await ctx.answerCallbackQuery();
    const wallets = await listWallets(ctx.userId);
    const anyActive = wallets.some((w) => w.active);
    if (anyActive) {
      await Promise.all(wallets.map((w) => setWalletActive(ctx.userId, w.chain, false)));
      const { text, keyboard } = await renderView(ctx, "menu:main");
      await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
      return;
    }
    await ctx.editMessageText(ACTIVATE_CONFIRM_TEXT, { reply_markup: activateConfirmKeyboard() }).catch(() => {});
  });

  bot.callbackQuery("activate:confirm", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleActivateConfirmed(ctx);
  });

  bot.callbackQuery("activate:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await renderView(ctx, "menu:main");
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("menu:support", async (ctx) => {
    await ctx.answerCallbackQuery();
    const url = await resolveSupportUrl();
    const { text } = await renderSupportView();
    const keyboard = new InlineKeyboard();
    if (url) keyboard.url("💬 Contact Support ↗", url).row();
    keyboard.text("⬅ Back", "menu:main");
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:toggle:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.callbackQuery.data.slice("settings:toggle:".length);
    const settings = await getUserSettings(ctx.userId);
    if (key === "ruggGuard") await updateUserSettings(ctx.userId, { ruggGuardEnabled: !settings.ruggGuardEnabled });
    else if (key === "antiMev") await updateUserSettings(ctx.userId, { antiMevEnabled: !settings.antiMevEnabled });
    else if (key === "alerts") await updateUserSettings(ctx.userId, { alertsEnabled: !settings.alertsEnabled });
    const { text, keyboard } = await renderView(ctx, "menu:settings");
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("settings:reset", async (ctx) => {
    await ctx.answerCallbackQuery("Reset.");
    await resetUserSettings(ctx.userId);
    const { text, keyboard } = await renderView(ctx, "menu:settings");
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("settings:slippage", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await renderSlippageChainListView();
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:slippage:[a-z]+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chain = ctx.callbackQuery.data.split(":")[2] as Chain;
    const { text, keyboard } = await renderSlippageChainView(ctx.userId, chain);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:slippage:[a-z]+:(buy|sell)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, , chain, side] = ctx.callbackQuery.data.split(":");
    const { text, keyboard } = renderSlippageValueView(chain as Chain, side as "buy" | "sell");
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:slippage:[a-z]+:(buy|sell):set:/, async (ctx) => {
    await ctx.answerCallbackQuery("Saved.");
    const parts = ctx.callbackQuery.data.split(":");
    const chain = parts[2] as Chain;
    const side = parts[3] as "buy" | "sell";
    const raw = parts[5]!;
    const bps = raw === "auto" ? null : Math.round(Number(raw));
    await setSlippageOverride(ctx.userId, chain, side, bps);
    const { text, keyboard } = await renderSlippageChainView(ctx.userId, chain);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:slippage:[a-z]+:(buy|sell):custom$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, , chain, side] = ctx.callbackQuery.data.split(":");
    ctx.session.customEntry = { kind: "slippage", chain: chain as Chain, side: side as "buy" | "sell" };
    await ctx.conversation.enter("customValueEntry");
  });

  bot.callbackQuery("settings:buyamount", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await renderBuyAmountChainListView();
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:buyamount:[a-z]+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chain = ctx.callbackQuery.data.split(":")[2] as Chain;
    const overrides = await getWalletOverrides(ctx.userId, chain);
    const { text, keyboard } = renderBuyAmountValueView(chain, overrides.buyAmountOverride);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:buyamount:[a-z]+:set:/, async (ctx) => {
    const parts = ctx.callbackQuery.data.split(":");
    const chain = parts[2] as Chain;
    const raw = parts[4]!;
    if (raw !== "auto") {
      try {
        parseNativeAmount(chain, raw);
      } catch {
        await ctx.answerCallbackQuery({ text: "Invalid amount.", show_alert: true });
        return;
      }
    }
    await ctx.answerCallbackQuery("Saved.");
    await setBuyAmountOverride(ctx.userId, chain, raw === "auto" ? null : raw);
    const overrides = await getWalletOverrides(ctx.userId, chain);
    const { text, keyboard } = renderBuyAmountValueView(chain, overrides.buyAmountOverride);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:buyamount:[a-z]+:custom$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chain = ctx.callbackQuery.data.split(":")[2] as Chain;
    ctx.session.customEntry = { kind: "buyamount", chain };
    await ctx.conversation.enter("customValueEntry");
  });

  bot.callbackQuery("settings:stoploss", async (ctx) => {
    await ctx.answerCallbackQuery();
    const settings = await getUserSettings(ctx.userId);
    const { text, keyboard } = renderStopLossView(settings.stopLossPctOverride);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:stoploss:set:/, async (ctx) => {
    await ctx.answerCallbackQuery("Saved.");
    const raw = ctx.callbackQuery.data.split(":")[3]!;
    await updateUserSettings(ctx.userId, { stopLossPctOverride: parseAutoOrNumber(raw) });
    const settings = await getUserSettings(ctx.userId);
    const { text, keyboard } = renderStopLossView(settings.stopLossPctOverride);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("settings:takeprofit", async (ctx) => {
    await ctx.answerCallbackQuery();
    const settings = await getUserSettings(ctx.userId);
    const { text, keyboard } = renderTakeProfitView(settings.takeProfitPctOverride);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:takeprofit:set:/, async (ctx) => {
    await ctx.answerCallbackQuery("Saved.");
    const raw = ctx.callbackQuery.data.split(":")[3]!;
    await updateUserSettings(ctx.userId, { takeProfitPctOverride: parseAutoOrNumber(raw) });
    const settings = await getUserSettings(ctx.userId);
    const { text, keyboard } = renderTakeProfitView(settings.takeProfitPctOverride);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("settings:language", async (ctx) => {
    await ctx.answerCallbackQuery();
    const settings = await getUserSettings(ctx.userId);
    const { text, keyboard } = renderLanguageView(settings.languageCode);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^settings:language:set:/, async (ctx) => {
    await ctx.answerCallbackQuery("Saved.");
    const code = ctx.callbackQuery.data.split(":")[3]!;
    await updateUserSettings(ctx.userId, { languageCode: code });
    const settings = await getUserSettings(ctx.userId);
    const { text, keyboard } = renderLanguageView(settings.languageCode);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(/^rewards:claim:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const kind = ctx.callbackQuery.data.endsWith("cashback") ? "cashback" : "referral";
    const { text, keyboard } = renderClaimView(kind);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery("rewards:customcode", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("customReferralCode");
  });

  // Generic navigation catch-all — must be registered last so the specific
  // handlers above get first refusal at their exact callback data.
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const isNav = data.startsWith("menu:") || data.startsWith("portfolio:") || data === "wallet:deposit";
    if (!isNav) return;

    await ctx.answerCallbackQuery();
    const { text, keyboard } = await renderView(ctx, data);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });
}
