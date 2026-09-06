import { getDb } from "@clawd/db";
import { requireAdminSession, hasRole } from "@/lib/auth";
import { createNudgeMessageAction, toggleNudgeMessageAction, manualNudgeAction } from "@/lib/actions";
import { SelectAllCheckbox } from "@/components/SelectAllCheckbox";

export default async function NudgesPage() {
  const session = await requireAdminSession();
  const canOperate = hasRole(session.role, "operator");
  const db = getDb();

  const [messages, inactiveUsers] = await Promise.all([
    db.nudgeMessage.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    db.user.findMany({
      // Anyone without an active wallet — including someone who never
      // created/imported one at all, matching apps/bot/src/reengagement.ts's
      // own eligibility query.
      where: { NOT: { wallets: { some: { active: true } } } },
      orderBy: { createdAt: "desc" },
      select: { id: true, telegramUsername: true, telegramId: true, nudgeCount: true },
    }),
  ]);
  const activeMessages = messages.filter((m) => m.active);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">Re-engagement Nudges</h1>
      <p className="text-sm text-white/60">
        Automatic reminders sent to users who created a wallet but never activated it — real
        features only, no fabricated urgency or discounts. Cadence (cooldown hours, max nudges per
        user, on/off) is controlled from Settings. A user's nudge count picks which message below
        they get next, in order; the last active message is reused for any further sends up to the
        cap.
      </p>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Messages</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Content</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td>{m.order}</td>
                <td className="max-w-md text-xs text-white/80">{m.content}</td>
                <td>{m.active ? "🟢 active" : "⚪ inactive"}</td>
                <td>
                  {canOperate ? (
                    <form action={toggleNudgeMessageAction.bind(null, m.id, !m.active)}>
                      <button type="submit" className="btn btn-secondary">
                        {m.active ? "Disable" : "Enable"}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {messages.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-white/50">
                  No messages configured yet — the automatic cadence won't send anything until at
                  least one is added below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canOperate ? (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">New message</h2>
          <p className="mb-3 text-xs text-white/50">
            Use <code>${"{minDepositUsd}"}</code> anywhere in the text to insert the current
            activation threshold at send time.
          </p>
          <form action={createNudgeMessageAction} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-white/60">Message content</label>
              <textarea name="content" className="input min-h-24" required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">
                Order (lower sends first; a user's Nth nudge uses the Nth active message by order)
              </label>
              <input name="order" type="number" className="input" defaultValue={messages.length} />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Add message
            </button>
          </form>
        </div>
      ) : null}

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-white/80">Manual send</h2>
        <p className="mb-3 text-xs text-white/50">
          Queues an immediate send to selected non-activated users, bypassing the cooldown and cap
          — delivered by the bot process on its next check (a few minutes, not instant).
        </p>
        {!canOperate ? (
          <p className="text-sm text-white/50">
            Your role ({session.role}) is read-only — sending requires the operator role or higher.
          </p>
        ) : (
          <form action={manualNudgeAction} className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs text-white/60">Users (never activated)</label>
                <SelectAllCheckbox />
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-black/30 p-2">
                {inactiveUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-white/5">
                    <input type="checkbox" name="userIds" value={u.id} className="user-checkbox accent-accent" />
                    {u.telegramUsername ? `@${u.telegramUsername}` : u.telegramId}
                    <span className="text-white/40">— {u.nudgeCount} sent so far</span>
                  </label>
                ))}
                {inactiveUsers.length === 0 ? (
                  <p className="px-1.5 py-1 text-sm text-white/50">No non-activated users right now.</p>
                ) : null}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Message</label>
              <select name="messageId" className="input" required>
                {activeMessages.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.content.slice(0, 60)}
                    {m.content.length > 60 ? "…" : ""}
                  </option>
                ))}
              </select>
              {activeMessages.length === 0 ? (
                <p className="mt-1 text-xs text-white/50">Add at least one active message above first.</p>
              ) : null}
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={activeMessages.length === 0}>
              Queue send
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
