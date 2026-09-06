import { getDb } from "@clawd/db";

export default async function AuditLogPage() {
  const db = getDb();

  const [logs, adminActions] = await Promise.all([
    db.keyAccessLog.findMany({ orderBy: { accessedAt: "desc" }, take: 200 }),
    db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  const userIds = [...new Set(logs.map((l) => l.userId))];
  const walletIds = [...new Set(logs.map((l) => l.walletId))];
  const [users, wallets] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } } }),
    db.wallet.findMany({ where: { id: { in: walletIds } } }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const walletMap = new Map(wallets.map((w) => [w.id, w]));

  return (
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <div>
          <h1 className="text-lg font-semibold">Key Access Audit Log</h1>
          <p className="text-sm text-white/60">
            Every time a raw private key was decrypted and revealed from this dashboard — this is the
            only accountability trail for that action, since it bypasses the bot's own passphrase-gated
            /export flow. Rows are never deleted, even if the user or wallet is later removed.
          </p>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>User</th>
              <th>Chain</th>
              <th>Wallet address</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const user = userMap.get(log.userId);
              const wallet = walletMap.get(log.walletId);
              return (
                <tr key={log.id}>
                  <td className="whitespace-nowrap text-xs">{log.accessedAt.toLocaleString()}</td>
                  <td>{log.adminUsername}</td>
                  <td>{user ? (user.telegramUsername ? `@${user.telegramUsername}` : user.telegramId) : log.userId}</td>
                  <td className="capitalize">{log.chain}</td>
                  <td className="font-mono text-xs">{wallet?.address ?? "(wallet deleted)"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {logs.length === 0 ? <p className="text-white/50">No key reveals logged yet.</p> : null}

        <div>
          <h1 className="text-lg font-semibold">Admin Activity</h1>
          <p className="text-sm text-white/60">
            Every write action taken from this dashboard — settings changes, rule/trade actions, wallet
            pause/deploy, user and admin-account management.
          </p>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Role</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {adminActions.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap text-xs">{row.createdAt.toLocaleString()}</td>
                <td>{row.adminUsername}</td>
                <td className="capitalize">{row.adminRole.replace("_", " ")}</td>
                <td className="font-mono text-xs">{row.action}</td>
                <td className="text-xs text-white/60">
                  {row.targetType ? `${row.targetType}:${row.targetId}` : "—"}
                </td>
                <td className="max-w-xs truncate text-xs text-white/50">
                  {row.details ? JSON.stringify(row.details) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {adminActions.length === 0 ? <p className="text-white/50">No admin activity logged yet.</p> : null}
      </main>
  );
}
