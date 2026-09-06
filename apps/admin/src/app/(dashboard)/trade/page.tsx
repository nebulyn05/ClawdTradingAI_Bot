import { getDb } from "@clawd/db";
import { requireAdminSession, hasRole } from "@/lib/auth";
import { manualTradeAction } from "@/lib/actions";
import { SelectAllCheckbox } from "@/components/SelectAllCheckbox";

const CHAINS = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"] as const;

export default async function TradePage() {
  const session = await requireAdminSession();
  const canOperate = hasRole(session.role, "operator");
  const users = await getDb().user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, telegramUsername: true, telegramId: true },
  });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">Manual Trade</h1>
      <p className="text-sm text-white/60">
        Buys directly through the same Router path Sniper/Scout/Rules use — still subject to the
        per-chain concurrency cap and the duplicate-position check, but skips Guard's safety
        screening entirely. Use with care. Select one or more users to fire the same buy for each of
        them independently — one user's rejection doesn't block the others.
      </p>
      {!canOperate ? (
        <p className="card text-sm text-white/50">
          Your role ({session.role}) is read-only — manual trading requires the operator role or higher.
        </p>
      ) : (
        <form action={manualTradeAction} className="card space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs text-white/60">Users</label>
              <SelectAllCheckbox />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-black/30 p-2">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-white/5">
                  <input type="checkbox" name="userIds" value={u.id} className="user-checkbox accent-accent" />
                  {u.telegramUsername ? `@${u.telegramUsername}` : u.telegramId}
                </label>
              ))}
              {users.length === 0 ? <p className="px-1.5 py-1 text-sm text-white/50">No users yet.</p> : null}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Chain</label>
            <select name="chain" className="input" required>
              {CHAINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Token address</label>
            <input name="tokenAddress" className="input font-mono text-xs" required />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">
              Size (native units, e.g. 0.1) — leave blank to use each wallet's configured trade size
            </label>
            <input name="sizeNative" className="input" placeholder="0.1" />
          </div>
          <button type="submit" className="btn btn-primary w-full">
            Execute buy for selected users
          </button>
        </form>
      )}
    </main>
  );
}
