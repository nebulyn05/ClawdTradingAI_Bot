import { getDb } from "@clawd/db";
import type { RuleCondition, RuleAction } from "@clawd/core";
import { requireAdminSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { createRuleAction, toggleRuleAction } from "@/lib/actions";

const CHAINS = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"] as const;

export default async function RulesPage() {
  await requireAdminSession();
  const db = getDb();
  const [rules, executions] = await Promise.all([
    db.rule.findMany({ orderBy: { createdAt: "desc" } }),
    db.ruleExecution.findMany({
      orderBy: { triggeredAt: "desc" },
      take: 50,
      include: { rule: { select: { name: true } } },
    }),
  ]);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Rules</h1>
        <p className="text-sm text-white/60">
          Each rule fires its action at most once per user — once true, it stays fired. Toggle it
          off and create a fresh rule to re-arm the same condition.
        </p>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">Active & past rules</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Condition</th>
                <th>Action</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const condition = r.condition as unknown as RuleCondition;
                const action = r.action as unknown as RuleAction;
                return (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="text-xs">
                      profit &gt; {condition.amountNative} {condition.chain}
                    </td>
                    <td className="text-xs">
                      buy {action.sizeNative} {action.chain} → {action.tokenAddress.slice(0, 8)}…
                    </td>
                    <td>{r.active ? "🟢 active" : "⚪ inactive"}</td>
                    <td>
                      <form action={toggleRuleAction.bind(null, r.id, !r.active)}>
                        <button type="submit" className="btn btn-secondary">
                          {r.active ? "Disable" : "Enable"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-white/50">
                    No rules yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">New rule</h2>
          <p className="mb-3 text-xs text-white/50">
            "If a user's realized profit on a chain exceeds an amount, buy them a specific token."
          </p>
          <form action={createRuleAction} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-white/60">Rule name</label>
              <input name="name" className="input" required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Condition: chain</label>
              <select name="conditionChain" className="input" required>
                {CHAINS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Condition: profit above (native units)</label>
              <input name="conditionAmount" className="input" placeholder="0.5" required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Action: chain</label>
              <select name="actionChain" className="input" required>
                {CHAINS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Action: buy size (native units)</label>
              <input name="actionSize" className="input" placeholder="0.1" required />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-white/60">Action: token address to buy</label>
              <input name="actionToken" className="input font-mono text-xs" required />
            </div>
            <div className="col-span-2">
              <button type="submit" className="btn btn-primary w-full">
                Create rule
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">Execution log</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Rule</th>
                <th>User</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((e) => (
                <tr key={e.id}>
                  <td>{e.triggeredAt.toLocaleString()}</td>
                  <td>{e.rule.name}</td>
                  <td className="font-mono text-xs">{e.userId.slice(0, 10)}…</td>
                  <td>{e.status}</td>
                </tr>
              ))}
              {executions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-white/50">
                    No rule executions yet.
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
