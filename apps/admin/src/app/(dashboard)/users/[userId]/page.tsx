import Link from "next/link";
import { notFound } from "next/navigation";
import { formatNativeAmount } from "@clawd/chains";
import { requireAdminSession, hasRole } from "@/lib/auth";
import { getUserDetail } from "@/lib/user-detail";
import { formatUsd } from "@/lib/balances";
import {
  setWalletActiveAction,
  updateUserSettingsAction,
  resetUserSettingsAction,
  updateWalletOverridesAction,
} from "@/lib/actions";
import { RevealKeyButton } from "@/components/RevealKeyButton";
import { DeleteUserButton } from "@/components/DeleteUserButton";

function pct(v: number | null): string {
  return v === null ? "Auto" : `${(v * 100).toFixed(0)}%`;
}

/** Same codes as the bot's own Settings > Language menu (apps/bot/src/menu.ts's LANGUAGES) — kept in sync manually since it's a short, rarely-changing list. */
const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese" },
  { code: "tr", label: "Turkish" },
  { code: "de", label: "German" },
  { code: "id", label: "Indonesian" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "ko", label: "Korean" },
  { code: "es", label: "Spanish" },
];

function txHistoryStatusLabel(status: "ok" | "unavailable" | "unsupported"): string {
  switch (status) {
    case "ok":
      return "🟢 live";
    case "unavailable":
      return "🟡 unavailable";
    case "unsupported":
      return "⚪ no explorer";
  }
}

function directionLabel(direction: "in" | "out" | "self" | "unknown"): string {
  switch (direction) {
    case "in":
      return "⬇️ in";
    case "out":
      return "⬆️ out";
    case "self":
      return "↔️ self";
    case "unknown":
      return "—";
  }
}

export default async function UserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requireAdminSession();
  const canOperate = hasRole(session.role, "operator");
  const canManage = hasRole(session.role, "super_admin");
  const { userId } = await params;
  const user = await getUserDetail(userId);
  if (!user) notFound();

  const label = user.telegramUsername ? `@${user.telegramUsername}` : user.telegramId;
  const winRate = user.stats.totalTrades > 0 ? `${((user.stats.wins / user.stats.totalTrades) * 100).toFixed(0)}%` : "—";

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/users" className="text-xs text-accent hover:underline">
            ← Users & Wallets
          </Link>
          <h1 className="mt-1 text-lg font-semibold">{label}</h1>
          <p className="text-xs text-white/50">
            Telegram ID {user.telegramId} · joined {user.createdAt.toLocaleDateString()} · export passphrase{" "}
            {user.hasExportPassphrase ? "set" : "not set"}
          </p>
        </div>
        {canManage ? <DeleteUserButton userId={user.id} label={label} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="card">
          <div className="stat-value">{formatUsd(user.totalBalanceUsd)}</div>
          <div className="stat-label">Total balance (live, USD est.)</div>
        </div>
        <div className="card">
          <div className="stat-value">{user.stats.totalTrades}</div>
          <div className="stat-label">Sell trades</div>
        </div>
        <div className="card">
          <div className="stat-value">{winRate}</div>
          <div className="stat-label">Win rate</div>
        </div>
        <div className="card">
          <div className="stat-value">{user.openPositions.length}</div>
          <div className="stat-label">Open positions</div>
        </div>
        <div className="card">
          <div className="stat-value">{user.stats.closedPositions}</div>
          <div className="stat-label">Closed positions</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Wallets</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Chain</th>
              <th>Address</th>
              <th>Balance</th>
              <th>USD est.</th>
              <th>Tx history</th>
              <th>Overrides (buy amt / slip buy / slip sell)</th>
              <th>Status</th>
              <th></th>
              {canManage ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {user.wallets.map((wallet) => (
              <tr key={wallet.id}>
                <td className="capitalize">{wallet.chain}</td>
                <td className="font-mono text-xs">
                  {wallet.address}
                  {wallet.sharedAddress ? (
                    <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                      shared EVM
                    </span>
                  ) : null}
                </td>
                <td className="text-xs">
                  {wallet.liveBalance === null ? (
                    <span className="text-white/30">unavailable</span>
                  ) : (
                    formatNativeAmount(wallet.chain, wallet.liveBalance)
                  )}
                </td>
                <td className="text-xs">
                  {wallet.usdValue === null ? (
                    <span className="text-white/30">unavailable</span>
                  ) : (
                    formatUsd(wallet.usdValue)
                  )}
                </td>
                <td className="text-xs">
                  {canOperate ? (
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        await updateWalletOverridesAction(wallet.id, formData);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        name="buyAmountOverride"
                        defaultValue={wallet.buyAmountOverride ?? ""}
                        placeholder="Auto"
                        title="Buy amount override"
                        className="input w-16 text-xs"
                      />
                      <input
                        name="slippageBuyPct"
                        defaultValue={wallet.slippageBuyBps !== null ? (wallet.slippageBuyBps / 100).toString() : ""}
                        placeholder="Auto"
                        title="Buy slippage %"
                        className="input w-14 text-xs"
                      />
                      <input
                        name="slippageSellPct"
                        defaultValue={wallet.slippageSellBps !== null ? (wallet.slippageSellBps / 100).toString() : ""}
                        placeholder="Auto"
                        title="Sell slippage %"
                        className="input w-14 text-xs"
                      />
                      <button type="submit" className="btn btn-secondary">
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      {wallet.buyAmountOverride ?? "Auto"} /{" "}
                      {wallet.slippageBuyBps !== null ? `${(wallet.slippageBuyBps / 100).toFixed(1)}%` : "Auto"} /{" "}
                      {wallet.slippageSellBps !== null ? `${(wallet.slippageSellBps / 100).toFixed(1)}%` : "Auto"}
                    </>
                  )}
                </td>
                <td className="text-xs">{wallet.active ? "🟢 deployed" : "⚪ paused"}</td>
                <td>
                  {canOperate ? (
                    <form action={setWalletActiveAction.bind(null, wallet.id, !wallet.active)}>
                      <button type="submit" className="btn btn-secondary">
                        {wallet.active ? "Pause" : "Deploy"}
                      </button>
                    </form>
                  ) : null}
                </td>
                {canManage ? (
                  <td>
                    <RevealKeyButton walletId={wallet.id} />
                  </td>
                ) : null}
              </tr>
            ))}
            {user.wallets.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-white/50">
                  No wallets.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-white/80">On-chain wallet activity (live)</h2>
        <p className="mb-3 text-xs text-white/50">
          Real blockchain history for these addresses — deposits, manual transfers, and bot-executed
          swaps alike — not just trades this bot itself recorded (see "Recent trades" below for that).
          Solana is read live via RPC; EVM chains go through Etherscan (needs{" "}
          <code className="text-white/70">ETHERSCAN_API_KEY</code> set — see Environment); Monad and
          Robinhood Chain have no known compatible explorer yet.
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Chain</th>
              <th>Address</th>
              <th>Direction</th>
              <th>Amount</th>
              <th>Result</th>
              <th>Tx hash</th>
            </tr>
          </thead>
          <tbody>
            {user.onChainTransactions.map((tx) => (
              <tr key={`${tx.chain}-${tx.hash}`}>
                <td className="whitespace-nowrap text-xs">{tx.timestamp ? tx.timestamp.toLocaleString() : "—"}</td>
                <td className="capitalize">{tx.chain}</td>
                <td className="font-mono text-xs">
                  {tx.walletAddress.slice(0, 6)}…{tx.walletAddress.slice(-4)}
                </td>
                <td className="text-xs">{directionLabel(tx.direction)}</td>
                <td className="text-xs">{formatNativeAmount(tx.chain as Parameters<typeof formatNativeAmount>[0], tx.valueRaw)}</td>
                <td>{tx.success ? "✅" : "❌"}</td>
                <td className="font-mono text-xs">
                  {tx.hash.slice(0, 8)}…{tx.hash.slice(-6)}
                </td>
              </tr>
            ))}
            {user.onChainTransactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-white/50">
                  No live transaction history available for this user's wallets.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">Trading settings</h2>
          {canOperate ? (
            <>
              <form
                action={async (formData: FormData) => {
                  "use server";
                  await updateUserSettingsAction(user.id, formData);
                }}
                className="space-y-3 text-sm"
              >
                <label className="flex items-center justify-between gap-4">
                  <span className="text-white/60">Take-profit</span>
                  <span className="flex items-center gap-1">
                    <input
                      name="takeProfitPct"
                      defaultValue={user.takeProfitPctOverride !== null ? (user.takeProfitPctOverride * 100).toString() : ""}
                      placeholder="Auto"
                      className="input w-20"
                    />
                    %
                  </span>
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-white/60">Stop-loss</span>
                  <span className="flex items-center gap-1">
                    <input
                      name="stopLossPct"
                      defaultValue={user.stopLossPctOverride !== null ? (user.stopLossPctOverride * 100).toString() : ""}
                      placeholder="Auto"
                      className="input w-20"
                    />
                    %
                  </span>
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-white/60">Rug Guard</span>
                  <input type="checkbox" name="ruggGuardEnabled" defaultChecked={user.ruggGuardEnabled} />
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-white/60">Anti-MEV</span>
                  <input type="checkbox" name="antiMevEnabled" defaultChecked={user.antiMevEnabled} />
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-white/60">Alerts</span>
                  <input type="checkbox" name="alertsEnabled" defaultChecked={user.alertsEnabled} />
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-white/60">Language</span>
                  <select name="languageCode" defaultValue={user.languageCode} className="input w-32">
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn btn-primary w-full">
                  Save
                </button>
              </form>
              <form
                action={async () => {
                  "use server";
                  await resetUserSettingsAction(user.id);
                }}
                className="mt-2"
              >
                <button type="submit" className="btn btn-secondary w-full">
                  Reset all to Auto/defaults
                </button>
              </form>
            </>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-white/60">Take-profit</dt>
                <dd>{pct(user.takeProfitPctOverride)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Stop-loss</dt>
                <dd>{pct(user.stopLossPctOverride)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Rug Guard</dt>
                <dd>{user.ruggGuardEnabled ? "✅ on" : "⚪ off"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Anti-MEV</dt>
                <dd>{user.antiMevEnabled ? "✅ on" : "⚪ off"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Alerts</dt>
                <dd>{user.alertsEnabled ? "✅ on" : "⚪ off"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Language</dt>
                <dd>{user.languageCode}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">Referrals</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-white/60">Referral code</dt>
              <dd>{user.referralCode ?? "not generated yet"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/60">Referred by</dt>
              <dd>
                {user.referredBy
                  ? user.referredBy.telegramUsername
                    ? `@${user.referredBy.telegramUsername}`
                    : user.referredBy.telegramId
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/60">Users referred</dt>
              <dd>{user.referralCount}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Open positions</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Chain</th>
              <th>Token</th>
              <th>Source</th>
              <th>Entry</th>
              <th>TP</th>
              <th>SL</th>
              <th>Size</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {user.openPositions.map((p) => (
              <tr key={p.id}>
                <td className="capitalize">{p.chain}</td>
                <td className="font-mono text-xs">{p.tokenAddress.slice(0, 10)}…</td>
                <td className="text-xs">{p.source}</td>
                <td>{p.entryPrice}</td>
                <td>{p.takeProfitPrice}</td>
                <td>{p.stopLossPrice}</td>
                <td className="text-xs">{p.sizeAmountIn}</td>
                <td className="whitespace-nowrap text-xs">{p.openedAt.toLocaleString()}</td>
              </tr>
            ))}
            {user.openPositions.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-white/50">
                  No open positions.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Recent trades</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Side</th>
              <th>Chain</th>
              <th>From address</th>
              <th>Token</th>
              <th>In</th>
              <th>Out</th>
              <th>Profitable</th>
              <th>Tx hash</th>
            </tr>
          </thead>
          <tbody>
            {user.recentTrades.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap text-xs">{t.createdAt.toLocaleString()}</td>
                <td className="capitalize">{t.side}</td>
                <td className="capitalize">{t.chain}</td>
                <td className="font-mono text-xs">
                  {t.walletAddress.slice(0, 6)}…{t.walletAddress.slice(-4)}
                </td>
                <td className="font-mono text-xs">{t.tokenAddress.slice(0, 10)}…</td>
                <td className="text-xs">{formatNativeAmount(t.chain as Parameters<typeof formatNativeAmount>[0], BigInt(t.amountIn))}</td>
                <td className="text-xs">{formatNativeAmount(t.chain as Parameters<typeof formatNativeAmount>[0], BigInt(t.amountOut))}</td>
                <td>{t.side === "sell" ? (t.profitable ? "✅" : "❌") : "—"}</td>
                <td className="font-mono text-xs">
                  {t.txHash.slice(0, 8)}…{t.txHash.slice(-6)}
                </td>
              </tr>
            ))}
            {user.recentTrades.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-white/50">
                  No trades yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
