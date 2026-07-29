import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadConfig } from "@clawd/core";
import { verifyPassphrase } from "@clawd/wallet";
import { createSessionToken, verifySessionToken, COOKIE_NAME } from "./session";

/**
 * Call at the top of every protected Server Component page. Redirects to
 * /login if there's no valid session — this app deliberately checks auth in
 * each page rather than in Next.js middleware, since middleware runs on the
 * Edge runtime by default and this app's session signing uses node:crypto.
 */
export async function requireAdminSession(): Promise<string> {
  const cookieStore = await cookies();
  const username = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!username) redirect("/login");
  return username;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export async function attemptLogin(username: string, password: string): Promise<LoginResult> {
  const cfg = loadConfig();
  if (!cfg.ADMIN_USERNAME || !cfg.ADMIN_PASSWORD_HASH) {
    return { ok: false, error: "Admin credentials aren't configured (ADMIN_USERNAME / ADMIN_PASSWORD_HASH)." };
  }
  if (username !== cfg.ADMIN_USERNAME) {
    return { ok: false, error: "Invalid username or password." };
  }
  const valid = await verifyPassphrase(password, cfg.ADMIN_PASSWORD_HASH);
  if (!valid) {
    return { ok: false, error: "Invalid username or password." };
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(username), {
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
