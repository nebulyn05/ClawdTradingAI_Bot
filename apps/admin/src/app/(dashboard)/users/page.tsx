import Link from "next/link";
import { getDb } from "@clawd/db";
import { requireAdminSession, hasRole } from "@/lib/auth";
import { DeleteUserButton } from "@/components/DeleteUserButton";

export default async function UsersPage() {
  const session = await requireAdminSession();
  const canManage = hasRole(session.role, "super_admin");
  const users = await getDb().user.findMany({
    include: { wallets: { select: { active: true } }, _count: { select: { positions: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">Users & Wallets</h1>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Wallets</th>
              <th>Positions</th>
              <th>Joined</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const label = user.telegramUsername ? `@${user.telegramUsername}` : user.telegramId;
              const activeWallets = user.wallets.filter((w) => w.active).length;
              return (
                <tr key={user.id}>
                  <td>
                    <Link href={`/users/${user.id}`} className="font-medium text-white hover:text-accent hover:underline">
                      {label}
                    </Link>
                  </td>
                  <td className="text-xs">
                    {activeWallets}/{user.wallets.length} deployed
                  </td>
                  <td className="text-xs">{user._count.positions}</td>
                  <td className="whitespace-nowrap text-xs text-white/50">{user.createdAt.toLocaleDateString()}</td>
                  <td>
                    <Link href={`/users/${user.id}`} className="btn btn-secondary">
                      View profile →
                    </Link>
                  </td>
                  <td>{canManage ? <DeleteUserButton userId={user.id} label={label} /> : null}</td>
                </tr>
              );
            })}
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-white/50">
                  No users yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
