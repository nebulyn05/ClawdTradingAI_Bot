import { createHmac, timingSafeEqual } from "node:crypto";
import { loadConfig } from "@clawd/core";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const COOKIE_NAME = "clawd_admin_session";

interface SessionPayload {
  username: string;
  exp: number;
}

function sign(payload: string): string {
  const { ADMIN_SESSION_SECRET } = loadConfig();
  // A blank/short secret would still "work" (HMAC accepts any key) but makes
  // every session cookie forgeable by anyone who notices it's unset — fail
  // loudly at first use instead of silently signing with a weak key.
  if (ADMIN_SESSION_SECRET.length < 32) {
    throw new Error(
      "ADMIN_SESSION_SECRET is unset or too short (needs 32+ chars) — admin sessions cannot be signed securely. " +
        "Set a long random value in .env before logging in.",
    );
  }
  return createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("hex");
}

/** Builds the signed cookie value for a successful login. */
export function createSessionToken(username: string): string {
  const payload: SessionPayload = { username, exp: Date.now() + SESSION_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/** Verifies a session cookie value. Returns the username if valid, null otherwise. */
export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload.username;
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
