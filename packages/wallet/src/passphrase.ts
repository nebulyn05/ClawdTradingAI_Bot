import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Hashes a user-chosen passphrase for the export-key re-authentication flow.
 * Uses scrypt (Node built-in, no native addon) rather than argon2 to avoid a
 * native-binding dependency; scrypt with these params is an accepted KDF choice.
 */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(passphrase, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassphrase(passphrase: string, encoded: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = encoded.split(":");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = (await scryptAsync(passphrase, salt, KEY_LENGTH)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
