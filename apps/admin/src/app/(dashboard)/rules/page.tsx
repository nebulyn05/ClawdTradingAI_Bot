import { getDb } from "@clawd/db";
import type { RuleCondition, RuleAction } from "@clawd/core";
import { requireAdminSession, hasRole } from "@/lib/auth";
import { createRuleAction, toggleRuleAction } from "@/lib/actions";

const CHAINS = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"] as const;

function describeCondition(condition: RuleCondition): string {
  switch (condition.type) {
    case "always":
      return "every user";
    case "newUser":
      return "new users";
    case "nativeBalanceAbove":
      return condition.chain + " balance > " + condition.amountNative;
    case "nativeBalanceBelow":
      return condition.chain + " balance < " + condition.amountNative;
    case "profitAbove":
      return condition.chain + " realized profit > " + condition.amountNative;
    case "profitBelow":
      return condition.chain + " realized profit < " + condition.amountNative;
    case "and":
      return condition.conditions.map(describeCondition).join(" AND ");
    case "or":
      return condition.conditions.map(describeCondition).join(" OR ");
  }
}

function describeAction(action: RuleAction): string {
  if (action.type !== "buy") return action.type;
  const mode = action.mode === "recurring"
    ? "recurring / " + (action.cooldownMinutes ?? 1440) + "m"
    : "once";
  return "buy " + action.sizeNative + " " + action.chain + " → " + action.tokenAddress.slice(0, 10) + "… (" + mode + ")";
}

export default async function RulesPage() {
  const session = await requireAdminSession();
  const canOperate = hasRole(session.role, "operator");
  const db = getDb();

  const [rules, executions] = await Promise.all([
    db.rule.findMany({ orderBy: { createdAt: "desc" } }),
    db.ruleExecution.findMany({
      orderBy: { triggeredAt: "desc" },
      take: 75,
      include: { rule: { select: { name: true } } },
    }),
  ]);

  return (
    <main className="page-shell space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">Automation Rules</h1>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            Worker-backed
          </span>
        </div>
        <p className="page-subtitle">
          Rules are evaluated by the trading worker and execute through the same Router used by manual trades.
          Wallet activation, exposure limits, duplicate-position checks and the global trading pause still apply.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="stat-label">Active rules</div>
          <div className="stat-value mt-1">{rules.filter((r) => r.active).length}</div>
        </div>
        <div className="card">
          <div className="stat-label">Executions logged</div>
          <div className="stat-value mt-1">{executions.length}</div>
        </div>
        <div className="card">
          <div className="stat-label">Execution model</div>
          <div className="mt-2 text-sm text-white/75">Once or recurring</div>
        </div>
      </div>

      {canOperate ? (
        <div className="card">
          <div className="mb-5">
            <h2 className="text-base font-semibold">Create automation</h2>
            <p className="mt-1 text-xs text-white/50">
              Examples: every new user buys X, every user buys Y, users with balance above X buy Z,
              or users whose realized profit exceeds G buy T.
            </p>
          </div>

          <form action={createRuleAction} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">Rule name</label>
              <input name="name" className="input" placeholder="Welcome token purchase" required />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">When</span>
                <span className="text-xs text-white/40">optional second condition</span>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Condition</label>
                  <select name="conditionType" className="input">
                    <option value="always">Every user</option>
                    <option value="newUser">New user</option>
                    <option value="nativeBalanceAbove">Native balance above</option>
                    <option value="nativeBalanceBelow">Native balance below</option>
                    <option value="profitAbove">Realized profit above</option>
                    <option value="profitBelow">Realized profit below</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Chain</label>
                  <select name="conditionChain" className="input">
                    {CHAINS.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Threshold (native)</label>
                  <input name="conditionAmount" className="input" placeholder="0.5" />
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Second condition</label>
                  <select name="condition2Type" className="input">
                    <option value="none">None</option>
                    <option value="nativeBalanceAbove">Balance above</option>
                    <option value="nativeBalanceBelow">Balance below</option>
                    <option value="profitAbove">Profit above</option>
                    <option value="profitBelow">Profit below</option>
                    <option value="newUser">New user</option>
                    <option value="always">Every user</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Logic</label>
                  <select name="conditionLogic" className="input">
                    <option value="and">AND</option>
                    <option value="or">OR</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Second chain</label>
                  <select name="condition2Chain" className="input">
                    {CHAINS.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Second threshold</label>
                  <input name="condition2Amount" className="input" placeholder="1.0" />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="mb-3 text-sm font-semibold">Then buy</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Trading chain</label>
                  <select name="actionChain" className="input" required>
                    {CHAINS.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Buy amount (native)</label>
                  <input name="actionSize" className="input" placeholder="0.1" required />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs text-white/60">Token address</label>
                  <input name="actionToken" className="input font-mono text-xs" placeholder="0x… or Solana mint" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Execution</label>
                  <select name="actionMode" className="input">
                    <option value="once">Once per user</option>
                    <option value="recurring">Recurring while matched</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-white/60">Recurring cooldown (minutes)</label>
                  <input name="cooldownMinutes" type="number" min="1" defaultValue="1440" className="input" />
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full sm:w-auto">
              Create automation rule
            </button>
          </form>
        </div>
      ) : null}

      <div className="card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white/80">Rules</h2>
            <p className="mt-1 text-xs text-white/40">The worker executes enabled rules on its schedule.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>When</th>
                <th>Action</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const condition = rule.condition as unknown as RuleCondition;
                const action = rule.action as unknown as RuleAction;
                return (
                  <tr key={rule.id}>
                    <td className="font-medium">{rule.name}</td>
                    <td className="max-w-[360px] text-xs text-white/65">{describeCondition(condition)}</td>
                    <td className="text-xs text-white/65">{describeAction(action)}</td>
                    <td>{rule.active ? "🟢 active" : "⚪ inactive"}</td>
                    <td>
                      {canOperate ? (
                        <form action={toggleRuleAction.bind(null, rule.id, !rule.active)}>
                          <button type="submit" className="btn btn-secondary whitespace-nowrap">
                            {rule.active ? "Disable" : "Enable"}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {rules.length === 0 ? (
                <tr><td colSpan={5} className="text-white/50">No rules yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Execution log</h2>
        <div className="table-scroll">
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
              {executions.map((execution) => (
                <tr key={execution.id}>
                  <td>{execution.triggeredAt.toLocaleString()}</td>
                  <td>{execution.rule.name}</td>
                  <td className="font-mono text-xs">{execution.userId.slice(0, 10)}…</td>
                  <td>{execution.status}</td>
                </tr>
              ))}
              {executions.length === 0 ? (
                <tr><td colSpan={4} className="text-white/50">No rule executions yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
