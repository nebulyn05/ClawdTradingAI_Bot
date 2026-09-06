import Link from "next/link";
import { getDb } from "@clawd/db";
import { formatNativeAmount } from "@clawd/chains";
import { getUserGrowth, getTradeActivity } from "@/lib/analytics";
import { getCumulativeWalletBalances, formatUsd } from "@/lib/balances";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { CATEGORICAL } from "@/components/charts/tokens";

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Auto-compact number formatting per the stat-tile spec: 1,284 / 12.9K / 4.2M. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default async function OverviewPage() {
  const db = getDb();

  const [
    userCount,
    walletCount,
    activeWalletCount,
    openPositionCount,
    feeRows,
    recentTrades,
    growth,
    tradeActivity,
    cumulativeBalances,
  ] = await Promise.all([
    db.user.count(),
    db.wallet.count(),
    db.wallet.count({ where: { active: true } }),
    db.position.count({ where: { status: "open" } }),
    db.feeLedger.groupBy({ by: ["chain"] }).then(async (groups) => {
      // amount is a raw bigint string per row — Prisma's _sum can't add
      // arbitrary-precision strings, so sum it manually per chain instead.
      const perChain = await Promise.all(
        groups.map(async (g) => {
          const rows = await db.feeLedger.findMany({ where: { chain: g.chain }, select: { amount: true } });
          const total = rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
          return { chain: g.chain, total };
        }),
      );
      return perChain;
    }),
    db.trade.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { position: { select: { chain: true, tokenAddress: true, userId: true } } },
    }),
    getUserGrowth(14),
    getTradeActivity(14),
    getCumulativeWalletBalances(),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Overview</h1>
        <p className="text-sm text-white/60">
          Platform snapshot.{" "}
          <Link href="/activity" className="text-accent hover:underline">
            Full activity & trends →
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="card">
          <div className="stat-value">{formatUsd(cumulativeBalances.totalUsd)}</div>
          <div className="stat-label">Total user balance (live, USD est.)</div>
        </div>
        <div className="card">
          <div className="stat-value">{compact(userCount)}</div>
          <div className="stat-label">Users</div>
        </div>
        <div className="card">
          <div className="stat-value">
            {activeWalletCount}/{compact(walletCount)}
          </div>
          <div className="stat-label">Deployed wallets</div>
        </div>
        <div className="card">
          <div className="stat-value">{compact(openPositionCount)}</div>
          <div className="stat-label">Open positions</div>
        </div>
        <div className="card">
          <div className="stat-value">{feeRows.length}</div>
          <div className="stat-label">Chains earning fees</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">User growth · last 14 days</h2>
          <LineChart
            labels={growth.labels.map(formatDay)}
            series={[{ name: "Users", color: CATEGORICAL[0], points: growth.cumulative }]}
            height={160}
          />
        </div>
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">Trades · last 14 days</h2>
          <BarChart
            labels={tradeActivity.labels.map(formatDay)}
            series={[
              { name: "Buys", color: CATEGORICAL[0], values: tradeActivity.buys },
              { name: "Sells", color: CATEGORICAL[1], values: tradeActivity.sells },
            ]}
            height={160}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-white/80">User wallet balances by chain (live)</h2>
        {cumulativeBalances.byChain.length === 0 ? (
          <p className="text-sm text-white/50">No wallets yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Chain</th>
                <th>Wallets</th>
                <th>Total balance</th>
                <th>USD est.</th>
              </tr>
            </thead>
            <tbody>
              {cumulativeBalances.byChain.map((row) => (
                <tr key={row.chain}>
                  <td className="capitalize">{row.chain}</td>
                  <td className="text-xs">
                    {row.walletCount}
                    {row.unavailableCount > 0 ? (
                      <span className="ml-1 text-white/30">({row.unavailableCount} unavailable)</span>
                    ) : null}
                  </td>
                  <td className="text-xs">{formatNativeAmount(row.chain, row.totalRaw)}</td>
                  <td className="text-xs">{formatUsd(row.usdValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Fee revenue (2% of profit)</h2>
        {feeRows.length === 0 ? (
          <p className="text-sm text-white/50">No fees collected yet.</p>
        ) : (
          <div className="flex flex-wrap gap-6">
            {feeRows.map((row) => (
              <div key={row.chain}>
                <div className="stat-value">{formatNativeAmount(row.chain, row.total)}</div>
                <div className="stat-label">{row.chain}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/80">Recent trades</h2>
          <Link href="/activity?type=trade" className="text-xs text-accent hover:underline">
            View all →
          </Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Side</th>
              <th>Chain</th>
              <th>Token</th>
              <th>Profitable</th>
            </tr>
          </thead>
          <tbody>
            {recentTrades.map((trade) => (
              <tr key={trade.id}>
                <td>{trade.createdAt.toLocaleString()}</td>
                <td className="capitalize">{trade.side}</td>
                <td>{trade.position.chain}</td>
                <td className="font-mono text-xs">{trade.position.tokenAddress.slice(0, 10)}…</td>
                <td>{trade.side === "sell" ? (trade.profitable ? "✅" : "❌") : "—"}</td>
              </tr>
            ))}
            {recentTrades.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-white/50">
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
