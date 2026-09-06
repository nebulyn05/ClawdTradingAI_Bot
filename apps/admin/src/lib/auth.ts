import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadConfig } from "@clawd/core";
import { getDb } from "@clawd/db";
import { verifyPassphrase, hashPassphrase } from "@clawd/wallet";
import { createSessionToken, verifySessionToken, COOKIE_NAME } from "./session";
import { hasRole, type AdminRole, type AdminSession } from "./roles";

// Re-exported so existing server-side call sites (`import { requireAdminSession, hasRole } from "@/lib/auth"`)
// keep working unchanged — client components must import these from "./roles" directly instead, since
// this module pulls in next/headers and can't be bundled for the client (see Sidebar.tsx).
export { hasRole, type AdminRole, type AdminSession };

/**
 * The old single-shared ADMIN_USERNAME/ADMIN_PASSWORD_HASH env pair now only
 * seeds the first `AdminUser` row (as super_admin) the first time anyone
 * logs in against an empty table — so a deployment that already has that
 * pair configured doesn't get locked out when this table ships. Every login
 * after that goes through AdminUser, not the env pair.
 */
async function ensureBootstrapAdmin(): Promise<void> {
  const db = getDb();
  const count = await db.adminUser.count();
  if (count > 0) return;
  const cfg = loadConfig();
  if (!cfg.ADMIN_USERNAME || !cfg.ADMIN_PASSWORD_HASH) return;
  await db.adminUser.create({
    data: { username: cfg.ADMIN_USERNAME, passwordHash: cfg.ADMIN_PASSWORD_HASH, role: "super_admin" },
  });
}

/**
 * Call at the top of every protected Server Component page (and every
 * write-side Server Action). Redirects to /login if there's no valid
 * session — this app deliberately checks auth in each page rather than in
 * Next.js middleware, since middleware runs on the Edge runtime by default
 * and this app's session signing uses node:crypto.
 *
 * Role is re-read from the database on every call rather than trusted from
 * the signed cookie (which only stores the username) — a role change or a
 * deactivated account takes effect on the very next request, not after the
 * session cookie happens to expire.
 *
 * Wrapped in React's `cache()` so the layout's call (default "analyst", just
 * to render the sidebar) and a page's own stricter call with the same
 * argument dedupe to one DB lookup per request instead of two.
 */
export const requireAdminSession = cache(async (minRole: AdminRole = "analyst"): Promise<AdminSession> => {
  const cookieStore = await cookies();
  const username = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!username) redirect("/login");

  const admin = await getDb().adminUser.findUnique({ where: { username } });
  if (!admin || !admin.active) redirect("/login");

  if (!hasRole(admin.role, minRole)) {
    throw new Error(`Forbidden — this action requires the "${minRole}" role or higher.`);
  }

  return { username: admin.username, role: admin.role };
});

export interface LoginResult {
  ok: boolean;
  error?: string;
}

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function attemptLogin(username: string, password: string): Promise<LoginResult> {
  await ensureBootstrapAdmin();

  const db = getDb();
  const admin = await db.adminUser.findUnique({ where: { username } });
  if (!admin || !admin.active) {
    return { ok: false, error: "Invalid username or password." };
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
    return { ok: false, error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` };
  }

  const valid = await verifyPassphrase(password, admin.passwordHash);
  if (!valid) {
    const attempts = admin.failedLoginAttempts + 1;
    const lockingOut = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    await db.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginAttempts: lockingOut ? 0 : attempts,
        lockedUntil: lockingOut ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
    return {
      ok: false,
      error: lockingOut
        ? `Too many failed attempts. Locked for ${Math.round(LOCKOUT_MS / 60000)} minutes.`
        : "Invalid username or password.",
    };
  }

  await db.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(admin.username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Hashes a new admin account password — same scrypt-based scheme as everything else in this app. */
export async function hashAdminPassword(password: string): Promise<string> {
  return hashPassphrase(password);
}

/**
 * Records an admin dashboard action for the activity/analytics views.
 * `adminRole` is captured at write time (not looked up later) so a
 * subsequent role change never rewrites what actually happened.
 */
export async function logAdminAction(
  session: AdminSession,
  action: string,
  target?: { type: string; id: string },
  details?: Record<string, unknown>,
): Promise<void> {
  await getDb().adminAuditLog.create({
    data: {
      adminUsername: session.username,
      adminRole: session.role,
      action,
      targetType: target?.type,
      targetId: target?.id,
      details: details as object | undefined,
    },
  });
}
