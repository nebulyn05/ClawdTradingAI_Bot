import { getDb } from "@clawd/db";
import { formatNativeAmount } from "@clawd/chains";
import { requireAdminSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export default async function OverviewPage() {
  await requireAdminSession();
  const db = getDb();

  const [userCount, walletCount, activeWalletCount, openPositionCount, feeRows, recentTrades] =
    await Promise.all([
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
    ]);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="card">
            <div className="stat-value">{userCount}</div>
            <div className="stat-label">Users</div>
          </div>
          <div className="card">
            <div className="stat-value">
              {activeWalletCount}/{walletCount}
            </div>
            <div className="stat-label">Deployed wallets</div>
          </div>
          <div className="card">
            <div className="stat-value">{openPositionCount}</div>
            <div className="stat-label">Open positions</div>
          </div>
          <div className="card">
            <div className="stat-value">{feeRows.length}</div>
            <div className="stat-label">Chains earning fees</div>
          </div>
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
          <h2 className="mb-3 text-sm font-semibold text-white/80">Recent trades</h2>
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
    </div>
  );
}
