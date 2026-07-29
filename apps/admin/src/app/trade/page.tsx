import { getDb } from "@clawd/db";
import { requireAdminSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { manualTradeAction } from "@/lib/actions";

const CHAINS = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"] as const;

export default async function TradePage() {
  await requireAdminSession();
  const users = await getDb().user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, telegramUsername: true, telegramId: true },
  });

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Manual Trade</h1>
        <p className="text-sm text-white/60">
          Buys directly through the same Router path Sniper/Scout/Rules use — still subject to the
          per-chain concurrency cap and the duplicate-position check, but skips Guard's safety
          screening entirely. Use with care.
        </p>
        <form action={manualTradeAction} className="card space-y-4">
          <div>
            <label className="mb-1 block text-xs text-white/60">User</label>
            <select name="userId" className="input" required>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.telegramUsername ? `@${u.telegramUsername}` : u.telegramId}
                </option>
              ))}
            </select>
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
              Size (native units, e.g. 0.1) — leave blank to use the wallet's configured trade size
            </label>
            <input name="sizeNative" className="input" placeholder="0.1" />
          </div>
          <button type="submit" className="btn btn-primary w-full">
            Execute buy
          </button>
        </form>
      </main>
    </div>
  );
}
