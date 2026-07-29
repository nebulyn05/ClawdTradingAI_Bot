import { getDb } from "@clawd/db";
import { requireAdminSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { forceClosePositionAction } from "@/lib/actions";

export default async function PositionsPage() {
  await requireAdminSession();
  const positions = await getDb().position.findMany({
    include: { user: { select: { telegramUsername: true, telegramId: true } } },
    orderBy: { openedAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Positions</h1>
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Chain</th>
                <th>Token</th>
                <th>Source</th>
                <th>Entry</th>
                <th>TP / SL</th>
                <th>Status</th>
                <th>Opened</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td>{p.user.telegramUsername ? `@${p.user.telegramUsername}` : p.user.telegramId}</td>
                  <td className="capitalize">{p.chain}</td>
                  <td className="font-mono text-xs">{p.tokenAddress.slice(0, 10)}…</td>
                  <td>{p.source}</td>
                  <td>{p.entryPrice.toPrecision(6)}</td>
                  <td>
                    {p.takeProfitPrice.toPrecision(4)} / {p.stopLossPrice.toPrecision(4)}
                  </td>
                  <td>
                    {p.status === "open" ? "🟢 open" : `closed (${p.exitReason ?? "?"})`}
                  </td>
                  <td>{p.openedAt.toLocaleString()}</td>
                  <td>
                    {p.status === "open" ? (
                      <form action={forceClosePositionAction.bind(null, p.id)}>
                        <button type="submit" className="btn btn-danger">
                          Force close
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-white/50">
                    No positions yet.
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
