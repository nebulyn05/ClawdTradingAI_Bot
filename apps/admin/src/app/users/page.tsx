import { getDb } from "@clawd/db";
import { requireAdminSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { setWalletActiveAction } from "@/lib/actions";

export default async function UsersPage() {
  await requireAdminSession();
  const users = await getDb().user.findMany({
    include: { wallets: true, _count: { select: { positions: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Users & Wallets</h1>
        <div className="space-y-4">
          {users.map((user) => (
            <div key={user.id} className="card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {user.telegramUsername ? `@${user.telegramUsername}` : user.telegramId}
                  </div>
                  <div className="text-xs text-white/50">
                    {user._count.positions} positions · joined {user.createdAt.toLocaleDateString()}
                  </div>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th>Network</th>
                    <th>Address</th>
                    <th>Trade size</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {user.wallets.map((wallet) => (
                    <tr key={wallet.id}>
                      <td className="capitalize">{wallet.chain}</td>
                      <td>{wallet.network}</td>
                      <td className="font-mono text-xs">{wallet.address}</td>
                      <td>{wallet.tradeSizeNative}</td>
                      <td>{wallet.active ? "🟢 deployed" : "⚪ paused"}</td>
                      <td>
                        <form
                          action={setWalletActiveAction.bind(null, wallet.id, !wallet.active)}
                        >
                          <button type="submit" className="btn btn-secondary">
                            {wallet.active ? "Pause" : "Deploy"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {users.length === 0 ? <p className="text-white/50">No users yet.</p> : null}
        </div>
      </main>
    </div>
  );
}
