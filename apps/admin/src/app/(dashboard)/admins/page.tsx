import { getDb } from "@clawd/db";
import { requireAdminSession } from "@/lib/auth";
import { createAdminAction, updateAdminRoleAction, resetAdminPasswordAction } from "@/lib/actions";
import { SetAdminActiveButton } from "@/components/SetAdminActiveButton";

const ROLES = ["super_admin", "operator", "analyst"] as const;

export default async function AdminsPage() {
  const session = await requireAdminSession("super_admin");
  const admins = await getDb().adminUser.findMany({ orderBy: { createdAt: "asc" } });

  return (
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-lg font-semibold">Admin Accounts</h1>
          <p className="text-sm text-white/60">
            super_admin: everything, including this page, key reveal, and user deletion. operator:
            trading operations (settings, rules, manual trade, wallet pause/deploy) — no key reveal, no
            account management. analyst: read-only everywhere.
          </p>
        </div>

        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Reset password</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td>{admin.username}</td>
                  <td>
                    <form action={updateAdminRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="adminUserId" value={admin.id} />
                      <select name="role" defaultValue={admin.role} className="input">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-secondary">
                        Update
                      </button>
                    </form>
                  </td>
                  <td>{admin.active ? "🟢 active" : "⚪ deactivated"}</td>
                  <td className="text-xs text-white/50">
                    {admin.lastLoginAt ? admin.lastLoginAt.toLocaleString() : "never"}
                  </td>
                  <td>
                    <form action={resetAdminPasswordAction} className="flex items-center gap-2">
                      <input type="hidden" name="adminUserId" value={admin.id} />
                      <input
                        type="password"
                        name="password"
                        placeholder="new password (min 8 chars)"
                        minLength={8}
                        className="input w-40"
                      />
                      <button type="submit" className="btn btn-secondary">
                        Reset
                      </button>
                    </form>
                  </td>
                  <td>
                    <SetAdminActiveButton adminUserId={admin.id} active={admin.active} username={admin.username} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-white/80">Create admin account</h2>
          <form action={createAdminAction} className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-white/60">Username</label>
              <input name="username" className="input" required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Password (min 8 chars)</label>
              <input type="password" name="password" className="input" minLength={8} required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Role</label>
              <select name="role" className="input" defaultValue="analyst">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <button type="submit" className="btn btn-primary w-full">
                Create account
              </button>
            </div>
          </form>
        </div>
      </main>
  );
}
